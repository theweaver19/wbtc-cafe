import { Transaction } from "../types/transaction";
import { EthArgs, UTXOIndex } from "@renproject/interfaces";
import { Asset } from "./assets";
import RenJS from "@renproject/ren";
import Web3 from "web3";
import { useFeesStore } from "../store/feeStore";
import { TxEvent } from "../store/transactionStore";

interface TransactionEvent {
  event:
    | "restored" // Has been persisted, but could be in any state
    | "created" // Created locally, but no external calls
    | "initialized" // Gateway address generated, but not submitted to renvm
    | "deposited" // RenVM detects a deposit confirmation from the source chain
    | "accepted" // Submitted to RenVM
    | "confirmation" // Source chain confirmation event (not neccessarily fully confirmed)
    | "confirmed"; // Accepted by RenVM and confirmed by source Network
  context: MintingContext; // Have to be careful with stale context
}

// Transaction build (RenLockAndMint) -> Get gateway addr -> get utxo by waiting for deposit -> submit after UTXO present and store signature
// -> wait for more btc confirmations -> submit to eth when finalized -> wait for eth confirmations

type TxDispatch = (txEvent: TxEvent) => void;

export const handleEvent = async (
  tx: Transaction,
  event: TransactionEvent,
  dispatch: TxDispatch
): Promise<Transaction> => {
  if (localStorage.getItem("nuking")) {
    return tx;
  }
  switch (event.event) {
    case "restored":
      switch (tx.awaiting) {
        case "btc-construct":
          return handleEvent(tx, { ...event, event: "created" }, dispatch);
        case "btc-init":
          return handleEvent(tx, { ...event, event: "initialized" }, dispatch);
        case "btc-settle":
          return handleEvent(tx, { ...event, event: "accepted" }, dispatch);
        case "ren-settle":
          if (!tx.sourceTxHash) {
            return handleEvent(tx, { ...event, event: "accepted" }, dispatch);
          }
          return handleEvent(tx, { ...event, event: "initialized" }, dispatch);
        case "eth-settle":
          dispatch({ tx, type: "confirmed" });
          return tx;
      }
      break;
    case "created":
      console.log("handling created");
      if (tx.type === "convert") {
        if (tx.sourceAsset === Asset.BTC) {
          const res = await initializeMinting(tx, event.context);
          console.log(res);
          dispatch({ tx: res, type: "created" });
          handleEvent(
            res,
            { event: "initialized", context: event.context },
            dispatch
          );
          return res;
        }
        if (tx.sourceNetwork === "ethereum") {
          return initializeBurning(tx);
        }
      }
      break;
    case "initialized":
      console.log("handling initialized");
      if (tx.type === "convert") {
        // doesn't quite make sense because we need the deposit txHash to continue
        let initTx = tx;
        if (!tx.sourceTxHash) {
          initTx = await waitForDeposit(tx, event.context, dispatch);
        } else {
          waitForDeposit(tx, event.context, dispatch);
        }
        const res = await submitToRenVM(initTx, event.context);
        dispatch({ tx: res, type: "initialized" });

        handleEvent(
          res,
          { event: "accepted", context: event.context },
          dispatch
        );
        return res;
      }
      break;

    case "accepted":
      console.log("handling accepted");
      const res3 = await waitForDeposit(tx, event.context, dispatch);
      dispatch({ tx: res3, type: "accepted" });
      if (res3.btcConfirmations ?? 0 > event.context.targetConfs) {
        return handleEvent(
          res3,
          { event: "confirmed", context: event.context },
          dispatch
        );
      }
      return res3;

    case "deposited":
      console.log("handling deposited");
      if (
        tx.renSignature &&
        (tx.btcConfirmations ?? 0 > event.context.targetConfs)
      ) {
        return handleEvent(
          tx,
          { event: "confirmed", context: event.context },
          dispatch
        );
      }
      return tx;

    case "confirmed":
      console.log("handling confirmed");
      // submission is actually handled by a call from a modal
      // although previously it would auto-submit if within bounds
      // await submitToEthereum(tx, event.context);
      const res2 = { ...tx, awaiting: "eth-init" };
      dispatch({ tx: res2, type: "confirmed" });
      return res2;
  }

  return tx;
};

interface MintingContext {
  sdk: RenJS;
  adapterAddress: string;
  localWeb3Address: string;
  gatherFeeData: ReturnType<typeof useFeesStore>["gatherFeeData"];
  localWeb3: Web3;
  targetConfs: number;
  convertAdapterAddress: string;
}

// As this is explicitly triggered by the user, we don't need this here
// const submitToEthereum = async (
//   tx: Transaction,
//   context: MintingContext
// ): Promise<Transaction> => {
//   console.log("Submit to Ethereum");
//   const {
//     localWeb3,
//     localWeb3Address,
//     gatherFeeData,
//     convertAdapterAddress,
//   } = context;

//   const { params, renSignature, renResponse } = tx;

//   const adapterContract = new localWeb3.eth.Contract(
//     adapterABI as AbiItem[],
//     convertAdapterAddress
//   );

//   const feeData = await gatherFeeData(Number(tx.amount));
//   if (!feeData) {
//     throw new Error("Failed to fetch fee data");
//   }
//   const newMinExchangeRate = params.contractCalls[0].contractParams[0].value;

//   return new Promise<Transaction>(async (resolve, reject) => {
//     try {
//       await adapterContract.methods
//         .mintThenSwap(
//           params.contractCalls[0].contractParams[0].value,
//           newMinExchangeRate,
//           params.contractCalls[0].contractParams[1].value,
//           params.contractCalls[0].contractParams[2].value,
//           renResponse.autogen.amount,
//           renResponse.autogen.nhash,
//           renSignature
//         )
//         .send({
//           from: localWeb3Address,
//         })
//         .on("transactionHash", (hash: string) => {
//           const newTx = {
//             ...tx,
//             awaiting: "eth-settle",
//             destTxHash: hash,
//             error: false,
//           };
//           return resolve(newTx);
//         });
//     } catch (error) {
//       reject(error);
//     }
//   });
// };

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

  const { targetConfs } = context;

  return new Promise<Transaction>(async (resolve, reject) => {
    const deposit = renLockAndMint(tx, context);
    return deposit
      .wait(targetConfs, source)
      .on("deposit", async (dep) => {
        console.log("deposited", dep);
        const newTx: Transaction = {
          ...tx,
          awaiting: tx.renSignature ? "btc-settle" : "ren-settle",
          btcConfirmations: dep.utxo.confirmations ?? 0,
          sourceTxHash: dep.utxo.txHash,
          sourceTxVOut: dep.utxo.vOut,
        };
        // FIXME: kill this listener at some point
        // We can't trust this firing multiple times as tx will be out of date
        dispatch({ tx: newTx, type: "deposited" });
        resolve(newTx);
      })
      .catch(reject);
  });
};

// After we have a deposit, submit after fetching by utxo details
const submitToRenVM = async (tx: Transaction, context: MintingContext) => {
  console.log("Getting renVM response");
  // Should always have these if waiting for a response
  if (!tx.sourceTxHash || String(tx.sourceTxVOut) === "undefined") {
    console.error("tried to submit without sourcetxhash");
    return { ...tx, error: true };
  }
  const mint = renLockAndMint(tx, context);

  // @ts-ignore: `renVMResponse` is private (TODO)
  const { renVMResponse, signature } = await (
    await mint.wait(context.targetConfs, {
      txHash: tx.sourceTxHash,
      vOut: tx.sourceTxVOut as number,
    })
  ).submit();
  console.log("submitted to renvm");

  const userBtcTxAmount = Number(
    (renVMResponse.in.utxo.amount / 10 ** 8).toFixed(8)
  );

  if (!renVMResponse || !signature || !userBtcTxAmount) {
    console.error("Invalid submission");
    throw new Error("Failed to submit tx to RenVM");
  }

  return {
    ...tx,
    awaiting: "btc-settle",
    sourceAmount: userBtcTxAmount,
    renResponse: renVMResponse,
    renSignature: signature,
  };
};

// Construct a mint request & set gateway address
const initializeMinting = async (tx: Transaction, context: MintingContext) => {
  console.log("init mint parameters");
  const deposit = renLockAndMint(tx, context);
  try {
    const renBtcAddress = await deposit.gatewayAddress();
    return {
      ...tx,
      // to match the previous flow, we first need to check for a btc-init tx
      awaiting: "btc-init", // "btc-settle",
      renBtcAddress,
      // @ts-ignore: property 'params' is private (TODO)
      params: deposit.params,
    };
  } catch (error) {
    console.error(error);
    return {
      ...tx,
      error,
    };
  }
};

const initializeBurning = (tx: Transaction) => {
  return tx;
};
