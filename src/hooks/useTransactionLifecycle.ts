import RenJS from "@renproject/ren";
import { useCallback, useEffect, useState, useRef } from "react";
import { EthArgs, UTXOIndex } from "@renproject/interfaces";
import { AbiItem } from "web3-utils";
import { useInterval } from "../hooks/useInterval";
import { FeeStore } from "../store/feeStore";
import { Store } from "../store/store";
import { Transaction } from "../types/transaction";
import adapterABI from "../utils/ABIs/adapterCurveABI.json";
import { Asset } from "../utils/assets";
import Web3 from "web3";
import { Transaction as EthTransaction } from "web3-core";

export enum TransactionEventTypes {
  "restored", // Transaction loaded from persistence, and needs to have lifecyle action determined
  "created", // User has provided parameters to create a transaction which has been persisted
  "initialized", // Gateway address generated, but no deposit yet detected
  "detected", // UTXO / txhash is detected in a deposit event / contract call
  "deposited", // RenVM detects a deposit confirmation from the source chain, utxo is present
  "confirmed", // Source chain has posted all neccessary confirmations
  "accepted", // Submitted to RenVM & signature returned
  "claimed", // Destination network contract interaction has been submitted
  "completed", // Destination network transaction has been confirmed
  "reverted", // Destination chain reverted the transaction (likely due to gas)
  "error", // An error occured while processing
}

export interface TxEvent {
  type: TransactionEventTypes;
  tx: Transaction;
}

export interface MintingContext {
  sdk: RenJS;
  adapterAddress: string;
  localWeb3Address: string;
  convertAdapterAddress: string;
}

export interface TransactionLifecycleMethods {
  completeConvertToEthereum: (
    transaction: Transaction,
    approveSwappedAsset?: string
  ) => Promise<void>;
  initConvertToEthereum: (tx: Transaction) => Promise<void>;
  initConvertFromEthereum: (tx: Transaction) => Promise<void>;
  initMonitoringTrigger: () => void;
}

const getTargetConfs = (
  tx: Transaction,
  network: "ethereum" | "bitcoin"
): number => {
  switch (network) {
    case "ethereum":
      return tx.sourceNetworkVersion === "testnet" ? 13 : 30;
    case "bitcoin":
      return tx.sourceNetworkVersion === "testnet" ? 2 : 6;
  }
};

const swapThenBurn = (
  adapter: any,
  to: string,
  from: string,
  amount: string | number,
  minSwapProceeds: number
) =>
  adapter.methods
    .swapThenBurn(
      RenJS.utils.BTC.addressToHex(to), //_to
      RenJS.utils.value(amount, Asset.BTC).sats().toNumber().toFixed(0), // _amount in Satoshis
      RenJS.utils.value(minSwapProceeds, Asset.BTC).sats().toNumber().toFixed(0)
    )
    .send({ from });

const getEthConfs = async (
  eth: Web3["eth"],
  txDetails: EthTransaction
): Promise<number> => {
  const currentBlock = await eth.getBlockNumber();
  return txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
    ? 0
    : currentBlock - txDetails.blockNumber;
};

export function useTransactionLifecycle(
  addTx: (x: Transaction) => void,
  getTx: (x: string) => Transaction | null,
  updateTx: (x: Transaction) => Transaction,
  txExists: (x: Transaction) => boolean
): TransactionLifecycleMethods {
  const {
    localWeb3Address,
    selectedNetwork,
    localWeb3,
    sdk,

    convertTransactions,
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

  const mintingContext = useRef<MintingContext>();

  // update context
  useEffect(() => {
    if (!localWeb3 || !sdk) return;
    mintingContext.current = {
      adapterAddress: convertAdapterAddress,
      convertAdapterAddress,
      sdk,
      localWeb3Address,
    };
  }, [convertAdapterAddress, gatherFeeData, localWeb3, sdk, localWeb3Address]);

  // We use a simple queue to store events that need to be processed
  const [txEvents, setTxEvents] = useState<TxEvent[]>([]);
  const addTxEvent = useCallback(
    (t: TxEvent) =>
      setTxEvents((x) => {
        return [t, ...x];
      }),
    [setTxEvents]
  );

  // Check confirmation status of ethereum minting transaction
  const checkMintingTx = useCallback(
    async (tx: Transaction) => {
      if (!localWeb3 || !tx.destTxHash) {
        return;
      }

      // Get transaction details
      const txDetails = await localWeb3.eth.getTransaction(tx.destTxHash);
      if (txDetails) {
        // Update confs
        const confs = await getEthConfs(localWeb3.eth, txDetails);
        if (confs > 0) {
          const receipt = await localWeb3.eth.getTransactionReceipt(
            tx.destTxHash
          );

          // reverted because gas ran out
          if (
            (receipt && ((receipt.status as unknown) as string) === "0x0") ||
            receipt.status === false
          ) {
            // addEvent "reverted"
            updateTx({ ...tx, error: true, destTxHash: "" });
          } else {
            updateTx({
              ...tx,
              destTxConfs: confs,
              awaiting: "",
              error: false,
            });
          }
        }
      } else {
        updateTx({ ...tx, error: true });
      }
    },
    [updateTx, localWeb3]
  );

  // Given a transaction, check its current ethereum confirmation status
  // and submit to renVM if ready
  const checkBurningTx = useCallback(
    async (tx) => {
      const web3 = localWeb3;
      if (!web3 || !sdk) return;
      const targetConfs = tx.sourceNetworkVersion === "testnet" ? 13 : 30;
      // Get latest tx state every iteration
      const latestTx = getTx(tx.id) || tx;
      if (!latestTx.sourceTxHash) {
        console.error("Missing ethereum tx!");
        addTxEvent({
          tx: { ...tx, error: true },
          type: TransactionEventTypes.error,
        });
        return;
      }

      // Get transaction details
      const txDetails = await web3.eth.getTransaction(latestTx.sourceTxHash);
      const confs = getEthConfs(web3.eth, txDetails);

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
    [sdk, localWeb3, updateTx, addTxEvent, getTx]
  );

  // monitor pending ethereum minting transactions
  const monitorTxs = useCallback(async () => {
    for (const tx of convertTransactions) {
      if (tx.awaiting === "eth-settle" && tx.sourceNetwork === "bitcoin") {
        checkMintingTx(tx);
      } else if (
        (tx.awaiting === "eth-settle" || tx.awaiting === "ren-settle") &&
        tx.sourceNetwork === "ethereum" &&
        !tx.error
      ) {
        checkBurningTx(tx);
      }
    }
  }, [convertTransactions, checkMintingTx, checkBurningTx]);

  // Check txs every 5 seconds
  useInterval(monitorTxs, 5000);

  // Called to check if the tx is aproved for current exchange rate,
  // and then submits to ethereum
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
      // if swap will revert to renBTC, let the user know before proceeding
      const exchangeRate = await getFinalDepositExchangeRate(tx);
      if (!exchangeRate || !minExchangeRate) {
        throw Error("missing exchange rates");
      }
      updateTx({ ...tx, exchangeRateOnSubmit: exchangeRate });
      if (!approveSwappedAsset && exchangeRate < minExchangeRate) {
        setSwapRevertModalTx(tx.id);
        setSwapRevertModalExchangeRate(exchangeRate.toFixed(8));
        setShowSwapRevertModal(true);
        updateTx({ ...tx, awaiting: "eth-init" });
        return;
      }

      let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
      if (approveSwappedAsset === Asset.WBTC) {
        const rateMinusOne =
          RenJS.utils.value(exchangeRate, Asset.BTC).sats().toNumber() - 1;
        newMinExchangeRate = rateMinusOne.toFixed(0);
      }

      const adapterContract = new localWeb3.eth.Contract(
        adapterABI as AbiItem[],
        convertAdapterAddress
      );

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
            addTxEvent({
              tx: {
                ...tx,
                awaiting: "eth-settle",
                destTxHash: hash,
                error: false,
              },
              type: TransactionEventTypes.claimed,
            });
          });
      } catch (e) {
        console.error(e);
        updateTx({ ...tx, error: true });
      }
    },
    [
      addTxEvent,
      convertAdapterAddress,
      getFinalDepositExchangeRate,
      localWeb3,
      localWeb3Address,
      setShowSwapRevertModal,
      setSwapRevertModalExchangeRate,
      setSwapRevertModalTx,
      updateTx,
    ]
  );

  const initConvertFromEthereum = useCallback(
    async function (tx: Transaction) {
      if (!localWeb3) return;
      const { amount, destAddress, minSwapProceeds } = tx;

      const adapter = new localWeb3.eth.Contract(
        adapterABI as AbiItem[],
        convertAdapterAddress
      );

      if (!txExists(tx)) {
        addTx(tx);
      } else if (tx.error) {
        // clear error when re-attempting
        updateTx({ ...tx, error: false });
      }

      try {
        await swapThenBurn(
          adapter,
          destAddress,
          localWeb3Address,
          amount,
          minSwapProceeds
        ).on("transactionHash", (hash: string) => {
          const newTx = {
            ...tx,
            awaiting: "eth-settle",
            sourceTxHash: hash,
            error: false,
          };
          addTxEvent({
            type: TransactionEventTypes.detected,
            tx: newTx,
          });
        });
      } catch (e) {
        console.error("eth burn error", e);
        addTxEvent({
          tx: { ...tx, error: true },
          type: TransactionEventTypes.error,
        });
        return;
      }
    },
    [
      updateTx,
      txExists,
      addTxEvent,
      convertAdapterAddress,
      localWeb3,
      localWeb3Address,
      addTx,
    ]
  );

  // On start-up
  const [monitoringStarted, setMonitoringStarted] = useState(false);
  const initMonitoringTrigger = useCallback(() => {
    setMonitoringStarted(true);
  }, [setMonitoringStarted]);

  const [monitoring, setMonitoring] = useState(false);

  // restore transactions on app-load
  useEffect(() => {
    if (monitoring || !mintingContext.current) {
      return;
    }
    const txs = convertTransactions.filter(
      (t) => t.sourceNetworkVersion === selectedNetwork
    );

    txs.map(async (tx) => {
      if (tx.sourceNetwork === "bitcoin") {
        try {
          addTxEvent({ tx, type: TransactionEventTypes.restored });
        } catch (err) {
          console.error(err);
        }
      }
      return null;
    });
    setMonitoring(true);
  }, [
    convertTransactions,
    mintingContext,
    addTxEvent,
    setMonitoring,
    monitoringStarted,
    selectedNetwork,
    monitoring,
  ]);

  const initConvertToEthereum = useCallback(
    async (tx: Transaction) => {
      addTxEvent({ tx, type: TransactionEventTypes.created });
      addTx(tx);
    },
    [addTxEvent, addTx]
  );

  const burnLifecycle = useCallback(
    (tx: Transaction, type: TransactionEventTypes) => {
      if (!mintingContext.current) return;
      switch (type) {
        case TransactionEventTypes.restored:
          switch (tx.awaiting) {
          }
          break;
        default:
          updateTx(tx);
      }
    },
    [mintingContext, updateTx]
  );

  const mintLifecycle = useCallback(
    (tx: Transaction, type: TransactionEventTypes) => {
      if (!mintingContext.current) return;
      switch (type) {
        case TransactionEventTypes.restored:
          // determine which event to be handled by translating tx awaiting
          // Should match the event that put the transaction in that state
          switch (tx.awaiting) {
            case "btc-init":
              addTxEvent({ tx, type: TransactionEventTypes.initialized });
              break;
            case "btc-settle":
              // Initialized, so we can listen
              addTxEvent({ tx, type: TransactionEventTypes.initialized });
              // We previously detected the tx, so submit in order to listen
              // for completion
              addTxEvent({ tx, type: TransactionEventTypes.detected });
              break;
            case "ren-settle":
              if (!tx.sourceTxHash) {
                // We don't have the transaction hash so wait for deposits
                addTxEvent({ tx, type: TransactionEventTypes.initialized });
              } else {
                // We just need to wait for renvm's response
                addTxEvent({ tx, type: TransactionEventTypes.detected });
              }
              break;
            case "eth-init":
              // Do we want to do this? If the user has multiple un-submitted txs
              // they may recieve multiple prompts & the prompts may override eachother
              // addTxEvent({ tx, type: TransactionEventTypes.accepted });
              break;
            case "eth-settle":
              addTxEvent({ tx, type: TransactionEventTypes.confirmed });
              break;
          }
          break;
        case TransactionEventTypes.created:
          initializeMinting(tx, mintingContext.current, addTxEvent);
          break;

        case TransactionEventTypes.initialized:
          updateTx(tx);
          // also start waiting for deposits
          waitForDeposit(tx, mintingContext.current, addTxEvent);
          break;

        case TransactionEventTypes.deposited:
          setShowGatewayModal(false);
          setGatewayModalTx(null);

          // Because deposit listener is long lived
          // tx in listener will be stale, so we should re-fetch
          const latestTx = getTx(tx.id) ?? tx;
          const newTx = {
            ...latestTx,
            btcConfirmations: tx.btcConfirmations ?? 0,
            sourceTxHash: tx.sourceTxHash,
            sourceTxVOut: tx.sourceTxVOut,
          };

          if (newTx.awaiting === "btc-init") {
            addTxEvent({ tx: newTx, type: TransactionEventTypes.detected });
          }

          const targetConfs = getTargetConfs(tx, "bitcoin");

          let awaiting = "btc-settle";
          if (tx.btcConfirmations ?? 0 >= targetConfs) {
            awaiting = tx.renSignature ? "eth-init" : "ren-settle";
          }
          newTx.awaiting = awaiting;

          updateTx(newTx);
          break;
        case TransactionEventTypes.detected:
          updateTx(tx);
          // submit to renvm even though tx is not confirmed,
          // so that lightnodes are aware of tx and approval is immediate
          submitToRenVM(tx, mintingContext.current, addTxEvent);
          break;
        case TransactionEventTypes.accepted:
          updateTx(tx);
          // Automatically submit if exchange rate is above minimum
          completeConvertToEthereum(tx);
          break;
        default:
          updateTx(tx);
      }
    },
    [
      addTxEvent,
      getTx,
      updateTx,
      mintingContext,
      setGatewayModalTx,
      completeConvertToEthereum,
      setShowGatewayModal,
    ]
  );

  // handle tx events
  useEffect(() => {
    if (txEvents.length === 0) return;
    const handledEvents = [...txEvents];
    setTxEvents([]);
    while (handledEvents.length > 0) {
      const event = handledEvents.pop();
      if (!event) {
        break;
      }
      const { type, tx } = event;
      if (tx.sourceNetwork === "bitcoin") {
        mintLifecycle(tx, type);
      }
      if (tx.sourceNetwork === "ethereum") {
        burnLifecycle(tx, type);
      }
    }
  }, [burnLifecycle, mintLifecycle, txEvents]);

  return {
    completeConvertToEthereum,
    initConvertToEthereum,
    initConvertFromEthereum,
    initMonitoringTrigger,
  };
}

const renLockAndMint = (tx: Transaction, context: MintingContext) => {
  console.log("Ren Lock and Mint");
  const {
    type,
    amount,
    params,
    destAddress,
    minExchangeRate,
    maxSlippage,
  } = tx;

  const { adapterAddress, localWeb3Address, sdk } = context;

  let contractFn = "";
  let contractParams: EthArgs = [];

  if (type === "convert") {
    contractFn = "mintThenSwap";
    contractParams = [
      {
        name: "_minExchangeRate",
        type: "uint256",
        value: RenJS.utils
          .value(Number(minExchangeRate), Asset.BTC)
          .sats()
          .toNumber()
          .toFixed(0),
      },
      {
        name: "_slippage",
        type: "uint256",
        value: Number(maxSlippage * 10000).toFixed(0),
      },
      {
        name: "_wbtcDestination",
        type: "address",
        value: destAddress,
      },
      {
        name: "_msgSender",
        type: "address",
        value: localWeb3Address,
      },
    ];
  }

  // store data or update params with nonce
  const data = {
    sendToken: RenJS.Tokens.BTC.Btc2Eth,
    suggestedAmount: RenJS.utils
      .value(amount, Asset.BTC)
      .sats()
      .toNumber()
      .toFixed(0),
    sendTo: adapterAddress,
    contractFn,
    contractParams,
    nonce: params && params.nonce ? params.nonce : RenJS.utils.randomNonce(),
  };

  const mint = sdk.lockAndMint(data);

  return mint;
};

type TxDispatch = (txEvent: TxEvent) => void;

// Construct a mint request & set gateway address
const initializeMinting = async (
  tx: Transaction,
  context: MintingContext,
  dispatch: TxDispatch
) => {
  const deposit = renLockAndMint(tx, context);
  try {
    const renBtcAddress = await deposit.gatewayAddress();
    dispatch({
      tx: {
        ...tx,
        // to match the previous flow, we first need to check for a btc-init tx
        awaiting: "btc-init",
        renBtcAddress,
        // @ts-ignore: property 'params' is private (TODO)
        params: deposit.params,
      },
      type: TransactionEventTypes.initialized,
    });
  } catch (error) {
    console.error(error);
    dispatch({
      tx: {
        ...tx,
        error,
      },
      type: TransactionEventTypes.error,
    });
  }
};

// Wait for deposits, utxo might be present
// Called when waiting to for pre-confirmation to provide utxo to renvm
// then to wait for number of confirmations to finalize transaction
const waitForDeposit = async (
  tx: Transaction,
  context: MintingContext,
  dispatch: TxDispatch
) => {
  console.log("Waiting for Deposit");

  let source: UTXOIndex | undefined = undefined;
  if (tx.sourceTxHash && String(tx.sourceTxVOut) !== "undefined") {
    source = {
      txHash: tx.sourceTxHash,
      vOut: tx.sourceTxVOut as number,
    };
  }

  const utxo = tx.renResponse?.in?.utxo;
  if (utxo?.txHash) {
    // wrong format?
    source = {
      txHash: utxo.txHash.slice(2),
      vOut: utxo.vOut,
    };
  }

  const targetConfs = getTargetConfs(tx, "bitcoin");

  return new Promise<Transaction>(async (resolve, reject) => {
    const deposit = renLockAndMint(tx, context);
    return deposit
      .wait(targetConfs, source)
      .on("deposit", async (dep) => {
        const newTx: Transaction = {
          ...tx,
          btcConfirmations: dep.utxo.confirmations ?? 0,
          sourceTxHash: dep.utxo.txHash,
          sourceTxVOut: dep.utxo.vOut,
        };
        // FIXME: kill this listener at some point
        // We can't trust this firing multiple times as tx will be out of date
        dispatch({ tx: newTx, type: TransactionEventTypes.deposited });

        // Promise will resolve with first recieved confirmation
        resolve(newTx);
      })
      .catch(reject);
  });
};

// After we have a deposit, submit after fetching by utxo details
const submitToRenVM = async (
  tx: Transaction,
  context: MintingContext,
  dispatch: TxDispatch
) => {
  // Should always have these if waiting for a response
  if (!tx.sourceTxHash || String(tx.sourceTxVOut) === "undefined") {
    console.error("tried to submit without sourcetxhash");
    return { ...tx, error: true };
  }
  const mint = renLockAndMint(tx, context);

  const targetConfs = getTargetConfs(tx, "bitcoin");

  // @ts-ignore: `renVMResponse` is private (TODO)
  const { renVMResponse, signature } = await (
    await mint.wait(targetConfs, {
      txHash: tx.sourceTxHash,
      vOut: tx.sourceTxVOut as number,
    })
  ).submit();

  const userBtcTxAmount = Number(
    (renVMResponse.in.utxo.amount / 10 ** 8).toFixed(8)
  );

  if (!renVMResponse || !signature || !userBtcTxAmount) {
    console.error("Invalid submission");
    throw new Error("Failed to submit tx to RenVM");
  }

  dispatch({
    tx: {
      ...tx,
      awaiting: "eth-init",
      sourceAmount: userBtcTxAmount,
      renResponse: renVMResponse,
      renSignature: signature,
    },
    type: TransactionEventTypes.accepted,
  });
};
