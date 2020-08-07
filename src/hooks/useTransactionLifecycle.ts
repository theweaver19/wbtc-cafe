import { Transaction } from "../types/transaction";

import { useInterval } from "../hooks/useInterval";

import { handleEvent } from "../utils/transaction";

import { useCallback, useEffect, useState } from "react";

import adapterABI from "../utils/ABIs/adapterCurveABI.json";
import { Asset } from "../utils/assets";

import { FeeStore } from "../store/feeStore";

import RenJS from "@renproject/ren";
import { AbiItem } from "web3-utils";

import { Store } from "../store/store";

export interface TxEvent {
  type:
    | "restored" // Has been persisted, but could be in any state
    | "created" // Created locally, but no external calls
    | "initialized" // Gateway address generated, but not submitted to renvm
    | "deposited" // RenVM detects a deposit confirmation from the source chain
    | "accepted" // Submitted to RenVM
    | "confirmation" // Source chain confirmation event (not neccessarily fully confirmed)
    | "confirmed" // Accepted by RenVM and confirmed by source Network
    | "eth-init";
  tx: Transaction; // tx
}

export function useTransactionLifecycle(
  addTx: (x: Transaction) => void,
  getTx: (x: string) => Transaction | null,
  updateTx: (x: Transaction) => Transaction,
  txExists: (x: Transaction) => boolean
) {
  const {
    localWeb3Address,
    selectedNetwork,
    localWeb3,
    sdk,
    fees,

    convertTransactions,
    convertExchangeRate,
    convertAdapterAddress,

    setSwapRevertModalTx,
    setSwapRevertModalExchangeRate,
    setShowSwapRevertModal,

    setShowGatewayModal,
    setGatewayModalTx,
  } = Store.useContainer();

  const {
    getFinalDepositExchangeRate,
    gatherFeeData,
  } = FeeStore.useContainer();

  const [txEvents, setTxEvents] = useState<TxEvent[]>([]);
  const addTxEvent = useCallback(
    (t: TxEvent) =>
      setTxEvents((x) => {
        console.log("adding txevent", t, x);
        return [t, ...x];
      }),
    [setTxEvents]
  );

  // Check confirmation status of ethereum transaction
  const checkMintingTx = useCallback(
    async (tx) => {
      if (!localWeb3) {
        return;
      }
      // Get latest tx state every iteration
      const latestTx = getTx(tx.id) || tx;
      if (!latestTx.destTxHash) {
        return;
      }

      // Get transaction details
      const txDetails = await localWeb3.eth.getTransaction(latestTx.destTxHash);
      if (txDetails) {
        const currentBlock = await localWeb3.eth.getBlockNumber();
        const confs =
          txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
            ? 0
            : currentBlock - txDetails.blockNumber;

        // Update confs
        if (confs > 0) {
          const receipt = await localWeb3.eth.getTransactionReceipt(
            latestTx.destTxHash
          );

          // reverted because gas ran out
          if (
            (receipt && ((receipt.status as unknown) as string) === "0x0") ||
            receipt.status === false
          ) {
            updateTx({ ...latestTx, error: true, destTxHash: "" });
          } else {
            updateTx({
              ...latestTx,
              destTxConfs: confs,
              awaiting: "",
              error: false,
            });
          }
        }
      } else {
        updateTx({ ...latestTx, error: true });
      }
    },
    [getTx, updateTx, localWeb3]
  );

  // monitor pending ethereum minting transactions
  const monitorMintingTxs = useCallback(async () => {
    const mintingTxs = convertTransactions.filter(
      (x) => x.awaiting === "eth-settle" && x.sourceNetwork === "bitcoin"
    );
    for (const tx of mintingTxs) {
      checkMintingTx(tx);
    }
  }, [convertTransactions, checkMintingTx]);

  useInterval(monitorMintingTxs, 5000);

  const completeConvertToEthereum = useCallback(
    async (transaction: Transaction, approveSwappedAsset?: string) => {
      if (!localWeb3) {
        return;
      }
      const renResponse = transaction.renResponse;

      // amount user sent
      const userBtcTxAmount = Number(
        (renResponse.in.utxo.amount / 10 ** 8).toFixed(8)
      );
      // amount in renvm after fixed fee
      const utxoAmountSats = renResponse.autogen.amount;

      // update amount to the actual amount sent
      const tx = updateTx({ ...transaction, sourceAmount: userBtcTxAmount });

      const { params, renSignature, minExchangeRate } = tx;
      const adapterContract = new localWeb3.eth.Contract(
        adapterABI as AbiItem[],
        convertAdapterAddress
      );

      // if swap will revert to renBTC, let the user know before proceeding
      const exchangeRate = await getFinalDepositExchangeRate(tx);
      updateTx({ ...tx, exchangeRateOnSubmit: exchangeRate });
      if (!approveSwappedAsset && exchangeRate! < minExchangeRate!) {
        setSwapRevertModalTx(tx.id);
        setSwapRevertModalExchangeRate(exchangeRate!.toFixed(8));
        setShowSwapRevertModal(true);
        updateTx({ ...tx, awaiting: "eth-init" });
        return;
      }

      let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
      if (approveSwappedAsset === Asset.WBTC) {
        const rateMinusOne =
          RenJS.utils.value(exchangeRate!, Asset.BTC).sats().toNumber() - 1;
        newMinExchangeRate = rateMinusOne.toFixed(0);
      }

      try {
        await adapterContract.methods
          .mintThenSwap(
            params.contractCalls[0].contractParams[0].value,
            newMinExchangeRate,
            params.contractCalls[0].contractParams[1].value,
            params.contractCalls[0].contractParams[2].value,
            utxoAmountSats,
            renResponse.autogen.nhash,
            renSignature
          )
          .send({
            from: localWeb3Address,
          })
          .on("transactionHash", (hash: string) => {
            updateTx({
              ...tx,
              awaiting: "eth-settle",
              destTxHash: hash,
              error: false,
            });
          });
      } catch (e) {
        console.error(e);
        updateTx({ ...tx, error: true });
      }
    },
    [
      convertAdapterAddress,
      getFinalDepositExchangeRate,
      getTx,
      localWeb3,
      localWeb3Address,
      setShowSwapRevertModal,
      setSwapRevertModalExchangeRate,
      setSwapRevertModalTx,
      updateTx,
    ]
  );

  const checkBurningTx = useCallback(
    async (tx) => {
      const web3 = localWeb3;
      if (!web3 || !sdk) return;
      const targetConfs = tx.sourceNetworkVersion === "testnet" ? 13 : 30;
      // Get latest tx state every iteration
      const latestTx = getTx(tx.id) || tx;
      if (!latestTx.sourceTxHash) {
        console.error("Missing ethereum tx!");
        return;
      }

      // Get transaction details
      const txDetails = await web3.eth.getTransaction(latestTx.sourceTxHash);
      const currentBlock = await web3.eth.getBlockNumber();
      const confs =
        txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
          ? 0
          : currentBlock - txDetails.blockNumber;

      // Update confs
      if (confs !== latestTx.sourceTxConfs) {
        updateTx({ ...latestTx, sourceTxConfs: confs });
      }

      // After enough confs, start watching RenVM
      if (latestTx.sourceTxConfs ?? 0 >= targetConfs) {
        if (latestTx.awaiting === "eth-settle") {
          updateTx({ ...latestTx, awaiting: "ren-settle" });
        }

        try {
          const burn = await sdk
            .burnAndRelease({
              sendToken: RenJS.Tokens.BTC.Eth2Btc,
              web3Provider: web3.currentProvider,
              ethereumTxHash: tx.sourceTxHash,
            })
            .readFromEthereum();
          const renVMTx = await burn.queryTx();
          if (renVMTx.txStatus === "done") {
            updateTx({
              ...latestTx,
              awaiting: "",
              error: false,
            });
          }
        } catch (e) {
          console.error(e);
        }
      }
    },
    [sdk, localWeb3, updateTx, getTx]
  );

  // WBTC to BTC
  const monitorBurningTxs = useCallback(async () => {
    const burningTxs = convertTransactions.filter(
      (x) =>
        (x.awaiting === "eth-settle" || x.awaiting === "ren-settle") &&
        x.sourceNetwork === "ethereum" &&
        !x.error
    );
    for (const tx of burningTxs) {
      checkBurningTx(tx);
    }
  }, [convertTransactions, checkBurningTx]);

  useInterval(monitorBurningTxs, 5000);

  const initConvertFromEthereum = useCallback(
    async function (tx: Transaction) {
      const web3 = localWeb3;
      if (!web3) return;
      const adapterAddress = convertAdapterAddress;
      const walletAddress = localWeb3Address;
      const { amount, destAddress, minSwapProceeds } = tx;

      const from = walletAddress;
      const adapter = new web3.eth.Contract(
        adapterABI as AbiItem[],
        adapterAddress
      );

      if (!txExists(tx)) {
        addTx(tx);
      } else if (tx.error) {
        // clear error when re-attempting
        updateTx({ ...tx, error: false });
      }

      try {
        await adapter.methods
          .swapThenBurn(
            RenJS.utils.BTC.addressToHex(destAddress), //_to
            RenJS.utils.value(amount, Asset.BTC).sats().toNumber().toFixed(0), // _amount in Satoshis
            RenJS.utils
              .value(minSwapProceeds, Asset.BTC)
              .sats()
              .toNumber()
              .toFixed(0)
          )
          .send({ from })
          .on("transactionHash", (hash: string) => {
            addTxEvent({
              type: "eth-init",
              tx: {
                ...tx,
                awaiting: "eth-settle",
                sourceTxHash: hash,
                error: false,
              },
            });
          });
      } catch (e) {
        console.error("eth burn error", e);
        updateTx({ ...tx, error: true });
        return;
      }
    },
    [updateTx, addTx]
  );

  // On start-up
  const [monitoringStarted, setMonitoringStarted] = useState(false);
  const initMonitoringTrigger = useCallback(() => {
    setMonitoringStarted(true);
  }, [setMonitoringStarted]);

  const [monitoring, setMonitoring] = useState(false);

  // restore transactions on app-load
  useEffect(() => {
    if (
      !monitoringStarted ||
      monitoring ||
      !localWeb3 ||
      !sdk ||
      !convertAdapterAddress
    ) {
      return;
    }

    const network = selectedNetwork;
    const txs = convertTransactions.filter(
      (t) => t.sourceNetworkVersion === network
    );

    txs.map(async (tx) => {
      if (tx.sourceNetwork === "bitcoin") {
        const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;

        try {
          await handleEvent(
            tx,
            {
              event: "restored",
              context: {
                adapterAddress: convertAdapterAddress,
                convertAdapterAddress,
                targetConfs,
                gatherFeeData,
                localWeb3,
                sdk,
                localWeb3Address,
              },
            },
            addTxEvent
          );
        } catch (err) {
          console.log(err);
        }
      }
      return null;
    });
    setMonitoring(true);
  }, [
    convertTransactions,
    convertExchangeRate,
    convertAdapterAddress,
    gatherFeeData,
    updateTx,
    addTxEvent,
    setMonitoring,
    localWeb3,
    localWeb3Address,
    monitoringStarted,
    sdk,
    selectedNetwork,
    monitoring,
  ]);

  const initConvertToEthereum = useCallback(
    async (tx: Transaction) => {
      if (!localWeb3 || !sdk || !fees || !convertAdapterAddress) {
        return;
      }
      const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;

      const newTx = await handleEvent(
        tx,
        {
          event: "created",
          context: {
            adapterAddress: convertAdapterAddress,
            gatherFeeData,
            convertAdapterAddress,
            targetConfs,
            localWeb3,
            sdk,
            localWeb3Address,
          },
        },
        addTxEvent
      );
      addTx(newTx);
      return newTx;
    },
    [
      localWeb3,
      sdk,
      fees,
      updateTx,
      convertAdapterAddress,
      gatherFeeData,
      localWeb3Address,
      addTx,
      addTxEvent,
    ]
  );

  // handle tx events
  useEffect(() => {
    if (!localWeb3 || !sdk || !fees || !convertAdapterAddress) {
      return;
    }
    while (txEvents.length > 0) {
      const event = txEvents.pop();
      if (!event) {
        break;
      }
      const { type, tx } = event;
      switch (type) {
        case "created":
          addTx(tx);
          break;
        case "deposited":
          setShowGatewayModal(false);
          setGatewayModalTx(null);
          // Because deposit listener is long lived
          // tx in listener will be stale, so we should re-fetch
          const latestTx = getTx(tx.id) ?? tx;
          const newTx = {
            ...latestTx,
            awaiting: tx.renSignature ? "btc-settle" : "ren-settle",
            btcConfirmations: tx.btcConfirmations ?? 0,
            sourceTxHash: tx.sourceTxHash,
            sourceTxVOut: tx.sourceTxVOut,
          };
          updateTx(newTx);

          const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;
          handleEvent(
            newTx,
            {
              event: "deposited",
              context: {
                adapterAddress: convertAdapterAddress,
                gatherFeeData,
                convertAdapterAddress,
                targetConfs,
                localWeb3,
                sdk,
                localWeb3Address,
              },
            },
            addTxEvent
          );
          break;
        default:
          updateTx(tx);
      }
      setTxEvents(txEvents);
    }
  }, [
    txEvents,
    handleEvent,
    addTx,
    getTx,
    updateTx,
    sdk,
    convertAdapterAddress,
  ]);
  return {
    completeConvertToEthereum,
    initConvertToEthereum,
    initConvertFromEthereum,
    initMonitoringTrigger,
  };
}
