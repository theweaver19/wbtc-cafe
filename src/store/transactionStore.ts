import RenJS from "@renproject/ren";
import { AbiItem } from "web3-utils";
import { BurnAndRelease } from "@renproject/ren/build/main/burnAndRelease";
import { createContainer } from "unstated-next";
import { List } from "immutable";
import { useCallback, useEffect, useState } from "react";
import { handleEvent } from "../utils/transaction";

import { Transaction } from "../types/transaction";
import adapterABI from "../utils/ABIs/adapterCurveABI.json";
import { Asset } from "../utils/assets";
import { Store } from "./store";
import { FeeStore } from "./feeStore";

function useTransactionStore() {
  const {
    db,
    fsEnabled,
    localWeb3Address,
    fsSignature,
    selectedNetwork,
    localWeb3,
    sdk,
    fees,

    convertTransactions,
    convertExchangeRate,
    convertPendingConvertToEthereum,
    convertAdapterAddress,

    setSwapRevertModalTx,
    setSwapRevertModalExchangeRate,
    setShowSwapRevertModal,

    setConvertTransactions,
    setConvertPendingConvertToEthereum,
  } = Store.useContainer();

  const {
    getFinalDepositExchangeRate,
    gatherFeeData,
  } = FeeStore.useContainer();

  // Changing TX State
  const addTx = useCallback(
    (tx: Transaction) => {
      const storeString = "convert.transactions";
      let txs = convertTransactions;
      txs = txs.push(tx);
      setConvertTransactions(List(txs.toArray()));

      // use localStorage
      localStorage.setItem(storeString, JSON.stringify(txs));

      if (fsEnabled) {
        try {
          db.addTx(tx, localWeb3Address, fsSignature).catch(console.error);
        } catch (e) {
          console.error(e);
        }
      }
    },
    [
      convertTransactions,
      db,
      fsEnabled,
      fsSignature,
      localWeb3Address,
      setConvertTransactions,
    ]
  );

  const updateTx = useCallback(
    (newTx: Transaction): Transaction => {
      const storeString = "convert.transactions";
      const txs = convertTransactions.map((t) => {
        if (t.id === newTx.id) {
          return newTx;
        }
        return t;
      });
      setConvertTransactions(List(txs.toArray()));

      // use localStorage
      localStorage.setItem(storeString, JSON.stringify(txs));

      if (fsEnabled) {
        try {
          db.updateTx(newTx).catch(console.error);
        } catch (e) {
          console.error(e);
        }
      }

      return newTx;
    },
    [convertTransactions, db, fsEnabled, setConvertTransactions]
  );

  const removeTx = (tx: Transaction) => {
    const storeString = "convert.transactions";
    const txs = convertTransactions.filter((t) => t.id !== tx.id);
    setConvertTransactions(List(txs.toArray()));

    // Use localStorage
    localStorage.setItem(storeString, JSON.stringify(txs));

    if (fsEnabled) {
      try {
        db.deleteTx(tx).catch(console.error);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const getTx = useCallback(
    (id: Transaction["id"]) => {
      return convertTransactions.filter((t) => t.id === id).first(null);
    },
    [convertTransactions]
  );

  const txExists = (tx: Transaction) => {
    return convertTransactions.filter((t) => t.id === tx.id).size > 0;
  };

  // BTC to WBTC
  const monitorMintTx = useCallback(
    async (tx: Transaction) => {
      const web3 = localWeb3;

      const interval = setInterval(async () => {
        // Get latest tx state every iteration
        const latestTx = getTx(tx.id) || tx;

        // Get transaction details
        const txDetails = await web3!.eth.getTransaction(latestTx.destTxHash!);
        if (txDetails) {
          const currentBlock = await web3!.eth.getBlockNumber();
          const confs =
            txDetails.blockNumber === null ||
            txDetails.blockNumber > currentBlock
              ? 0
              : currentBlock - txDetails.blockNumber;

          // Update confs
          if (confs > 0) {
            const receipt = await web3!.eth.getTransactionReceipt(
              latestTx.destTxHash!
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

            clearInterval(interval);
          }
        } else {
          updateTx({ ...latestTx, error: true });
          clearInterval(interval);
        }
      }, 1000);
    },
    [getTx, localWeb3, updateTx]
  );

  const completeConvertToEthereum = useCallback(
    async (transaction: Transaction, approveSwappedAsset?: string) => {
      const pending = convertPendingConvertToEthereum;
      const renResponse = transaction.renResponse;

      // amount user sent
      const userBtcTxAmount = Number(
        (renResponse.in.utxo.amount / 10 ** 8).toFixed(8)
      );
      // amount in renvm after fixed fee
      const utxoAmountSats = renResponse.autogen.amount;

      // update amount to the actual amount sent
      const tx = updateTx({ ...transaction, sourceAmount: userBtcTxAmount });

      const { id, params, renSignature, minExchangeRate } = tx;
      const adapterContract = new localWeb3!.eth.Contract(
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

      if (!tx.destTxHash) {
        updateTx({ ...tx, awaiting: "eth-settle" });
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
              const newTx = updateTx({ ...tx, destTxHash: hash, error: false });
              monitorMintTx(newTx).catch(console.error);
            });

          setConvertPendingConvertToEthereum(pending.filter((p) => p !== id));
        } catch (e) {
          console.error(e);
          updateTx({ ...tx, error: true });
        }
      } else {
        const transaction = getTx(tx.id) || tx;
        monitorMintTx(transaction).catch(console.error);
      }
    },
    [
      convertAdapterAddress,
      convertPendingConvertToEthereum,
      getFinalDepositExchangeRate,
      getTx,
      localWeb3,
      localWeb3Address,
      monitorMintTx,
      setConvertPendingConvertToEthereum,
      setShowSwapRevertModal,
      setSwapRevertModalExchangeRate,
      setSwapRevertModalTx,
      updateTx,
    ]
  );

  // WBTC to BTC
  const monitorBurnTx = useCallback(
    async (tx: Transaction) => {
      const web3 = localWeb3;
      const targetConfs = tx.sourceNetworkVersion === "testnet" ? 13 : 30;

      let burn: BurnAndRelease;
      try {
        burn = await sdk!
          .burnAndRelease({
            sendToken: RenJS.Tokens.BTC.Eth2Btc,
            web3Provider: web3!.currentProvider,
            ethereumTxHash: tx.sourceTxHash,
          })
          .readFromEthereum();
      } catch (e) {
        console.error(e);
        updateTx({ ...tx, error: true });
        return;
      }

      const interval = setInterval(async () => {
        // Get latest tx state every iteration
        const latestTx = getTx(tx.id) || tx;

        // Get transaction details
        const txDetails = await web3!.eth.getTransaction(
          latestTx.sourceTxHash!
        );
        const currentBlock = await web3!.eth.getBlockNumber();
        const confs =
          txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
            ? 0
            : currentBlock - txDetails.blockNumber;

        // Update confs
        if (confs !== latestTx.sourceTxConfs) {
          updateTx({ ...latestTx, sourceTxConfs: confs });
        }

        // After enough confs, start watching RenVM
        if (latestTx.sourceTxConfs! >= targetConfs) {
          if (latestTx.awaiting === "eth-settle") {
            updateTx({ ...latestTx, awaiting: "ren-settle" });
          }

          try {
            const renVMTx = await burn.queryTx();
            if (renVMTx.txStatus === "done") {
              updateTx({
                ...latestTx,
                awaiting: "",
                error: false,
              });
              clearInterval(interval);
            }
          } catch (e) {
            console.error(e);
          }
        }
      }, 1000);
    },
    [getTx, localWeb3, sdk, updateTx]
  );

  const initConvertFromEthereum = async function (tx: Transaction) {
    const web3 = localWeb3;
    const adapterAddress = convertAdapterAddress;
    const walletAddress = localWeb3Address;
    const { amount, destAddress, minSwapProceeds } = tx;

    const from = walletAddress;
    const adapter = new web3!.eth.Contract(
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
          updateTx({
            ...tx,
            awaiting: "eth-settle",
            sourceTxHash: hash,
            error: false,
          });
          const transaction = getTx(tx.id) || tx;
          monitorBurnTx(transaction).catch(console.error);
        });
    } catch (e) {
      console.error("eth burn error", e);
      updateTx({ ...tx, error: true });
      return;
    }
  };

  // On start-up
  const [monitoringStarted, setMonitoringStarted] = useState(false);
  const initMonitoringTrigger = useCallback(() => {
    setMonitoringStarted(true);
  }, [setMonitoringStarted]);

  const [monitoring, setMonitoring] = useState(false);

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

    // if (convertExchangeRate == "") {
    //   gatherFeeData();
    //   return;
    // }

    const network = selectedNetwork;
    const txs = convertTransactions.filter(
      (t) => t.sourceNetworkVersion === network
    );

    txs.map(async (tx) => {
      if (tx.sourceNetwork === "bitcoin") {
        const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;

        await handleEvent(
          tx,
          {
            event: "restored",
            context: {
              exchangeRate: 0, //convertExchangeRate,
              adapterAddress: convertAdapterAddress,
              convertAdapterAddress,
              targetConfs,
              gatherFeeData,
              localWeb3,
              sdk,
              localWeb3Address,
            },
          },
          (tx, event) => {
            console.log(tx, event);
            updateTx(tx);
            if (event.event === "confirmed") {
              monitorMintTx(tx);
            }
          }
        );

        // if (tx.destTxHash) {
        //   monitorMintTx(tx).catch(console.error);
        // } else {
        //   initConvertToEthereum(tx).catch(console.error);
        // }
      } else if (tx.sourceNetwork === "ethereum" && tx.awaiting && !tx.error) {
        monitorBurnTx(tx).catch(console.error);
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
    setMonitoring,
    monitorBurnTx,
    localWeb3,
    localWeb3Address,
    monitorMintTx,
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

      if (convertPendingConvertToEthereum.indexOf(tx.id) < 0) {
        setConvertPendingConvertToEthereum(
          convertPendingConvertToEthereum.concat([tx.id])
        );
      }
      const initializedTx = await handleEvent(tx, {
        event: "created",
        context: {
          exchangeRate: 0,
          adapterAddress: convertAdapterAddress,
          gatherFeeData,
          convertAdapterAddress,
          targetConfs,
          localWeb3,
          sdk,
          localWeb3Address,
        },
      });
      console.log(initializedTx);
      addTx(initializedTx);
      return initializedTx;
    },
    [
      localWeb3,
      sdk,
      fees,
      convertAdapterAddress,
      convertPendingConvertToEthereum,
      gatherFeeData,
      localWeb3Address,
      addTx,
      setConvertPendingConvertToEthereum,
    ]
  );

  return {
    updateTx,
    removeTx,
    completeConvertToEthereum,
    initConvertToEthereum,
    initConvertFromEthereum,
    initMonitoringTrigger,
  };
}

export const TransactionStore = createContainer(useTransactionStore);
