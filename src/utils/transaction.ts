import { Transaction } from "../types/transaction";
import { EthArgs, UTXOIndex } from "@renproject/interfaces";
import { Asset } from "./assets";
import RenJS from "@renproject/ren";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import adapterABI from "../utils/ABIs/adapterCurveABI.json";

interface TransactionEvent {
  event:
    | "restored" // Has been persisted, but could be in any state
    | "created" // Created locally, but no external calls
    | "initialized" // Gateway address generated, but not submitted to renvm
    | "accepted" // Submitted to RenVM
    | "confirmed"; // Accepted by RenVM and confirmed by source Network
  context: MintingContext;
}

export const handleEvent = async (
  tx: Transaction,
  event: TransactionEvent,
  listener?: (tx: Transaction, event: TransactionEvent) => void
): Promise<Transaction> => {
  console.log("handing tx event");
  switch (event.event) {
    case "restored":
      switch (tx.awaiting) {
        case "btc-init":
          return handleEvent(tx, { ...event, event: "created" }, listener);
        case "btc-settle":
          return handleEvent(tx, { ...event, event: "accepted" }, listener);
        case "ren-settle":
          if (!tx.sourceTxHash) {
            return handleEvent(tx, { ...event, event: "accepted" }, listener);
          }
          return handleEvent(tx, { ...event, event: "initialized" }, listener);
        case "eth-settle":
          listener &&
            listener(tx, { event: "confirmed", context: event.context });
          return tx;
      }
      break;
    case "created":
      if (tx.type === "convert") {
        if (tx.sourceAsset === Asset.BTC) {
          const res = await initializeMinting(tx, event.context);
          console.log(res);
          listener &&
            listener(res, { event: "created", context: event.context });
          handleEvent(res, { event: "initialized", context: event.context });
          return res;
        }
        if (tx.sourceNetwork === "ethereum") {
          return initializeBurning(tx);
        }
      }
      break;
    case "initialized":
      if (tx.type === "convert") {
        // doesn't quite make sense because we need the deposit txHash to continue
        const res = await getRenVMResponse(tx, event.context);
        listener &&
          listener(res, { event: "initialized", context: event.context });

        handleEvent(res, { event: "accepted", context: event.context });
        return res;
      }
      break;

    case "accepted":
      const res3 = await waitForDeposit(tx, event.context, listener);
      listener && listener(res3, { event: "accepted", context: event.context });
      if (res3.btcConfirmations ?? 0 > event.context.targetConfs) {
        return handleEvent(
          res3,
          { event: "confirmed", context: event.context },
          listener
        );
      }
      return res3;

    case "confirmed":
      // Need to break this up so that we don't need to wait for the method to confirm
      const res2 = await submitToEthereum(tx, event.context);
      listener &&
        listener(res2, { event: "confirmed", context: event.context });
      return res2;
  }

  return tx;
};

interface MintingContext {
  sdk: RenJS;
  adapterAddress: string;
  localWeb3Address: string;
  gatherFeeData: any;
  localWeb3: Web3;
  targetConfs: number;
  exchangeRate: number;
  convertAdapterAddress: string;
}

const submitToEthereum = async (
  tx: Transaction,
  context: MintingContext
): Promise<Transaction> => {
  console.log("Submit to Ethereum");
  const {
    localWeb3,
    localWeb3Address,
    gatherFeeData,
    convertAdapterAddress,
  } = context;

  const { params, renSignature, renResponse } = tx;

  const adapterContract = new localWeb3.eth.Contract(
    adapterABI as AbiItem[],
    convertAdapterAddress
  );

  const { exchangeRate } = await gatherFeeData(tx.amount);

  let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
  if (/* approveSwappedAsset === */ Asset.WBTC) {
    const rateMinusOne =
      RenJS.utils.value(exchangeRate, Asset.BTC).sats().toNumber() - 1;
    newMinExchangeRate = rateMinusOne.toFixed(0);
  }

  return new Promise<Transaction>(async (resolve, reject) => {
    try {
      await adapterContract.methods
        .mintThenSwap(
          params.contractCalls[0].contractParams[0].value,
          newMinExchangeRate,
          params.contractCalls[0].contractParams[1].value,
          params.contractCalls[0].contractParams[2].value,
          renResponse.autogen.amount,
          renResponse.autogen.nhash,
          renSignature
        )
        .send({
          from: localWeb3Address,
        })
        .on("transactionHash", (hash: string) => {
          const newTx = {
            ...tx,
            awaiting: "eth-settle",
            destTxHash: hash,
            error: false,
          };
          return resolve(newTx);
        });
    } catch (error) {
      reject(error);
    }
  });
};

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
const waitForDeposit = async (
  tx: Transaction,
  context: MintingContext,
  listener?: any
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

  console.log(source, tx);
  const { targetConfs } = context;

  return new Promise<Transaction>(async (resolve) => {
    const deposit = renLockAndMint(tx, context);
    console.log(deposit);
    deposit.wait(targetConfs, source).on("deposit", (dep) => {
      console.log("deposited", dep);
      const newTx = {
        ...tx,
        awaiting: tx.renSignature ? "btc-settle" : "ren-settle",
        btcConfirmations: dep.utxo.confirmations,
        sourceTxHash: dep.utxo.txHash,
        sourceTxVOut: dep.utxo.vOut,
      };
      listener && listener(newTx, { event: "deposited", context });
      resolve(newTx);
    });
  });
};

// Transaction build (RenLockAndMint) -> Get gateway addr -> get utxo by waiting for deposit -> submit after UTXO present and store signature
// -> wait for more btc confirmations -> submit to eth when finalized

// After we have a deposit, submit after fetching by utxo details
const getRenVMResponse = async (tx: Transaction, context: MintingContext) => {
  console.log("Getting renVM response");
  // Should always have these if waiting for a response
  if (!tx.sourceTxHash || String(tx.sourceTxVOut) === "undefined") {
    return { ...tx, error: true };
  }
  const mint = renLockAndMint(tx, context);

  // @ts-ignore: `renVMResponse` is private (TODO)
  const { renVMResponse, signature } = await (
    await mint.wait(0, {
      txHash: tx.sourceTxHash,
      vOut: tx.sourceTxVOut as number,
    })
  ).submit();

  const userBtcTxAmount = Number(
    (renVMResponse.in.utxo.amount / 10 ** 8).toFixed(8)
  );

  if (!renVMResponse || !signature || !userBtcTxAmount) {
    console.error("Invalid submission");
    throw "Failed to submit tx";
  }

  return {
    ...tx,
    awaiting: "btc-settle",
    sourceAmount: userBtcTxAmount,
    renResponse: renVMResponse,
    renSignature: signature,
  };
};

// Submit a mint request to RenVM
const initializeMinting = async (tx: Transaction, context: MintingContext) => {
  console.log("initizliaing minting");
  const deposit = renLockAndMint(tx, context);
  try {
    return {
      ...tx,
      awaiting: "btc-settle",
      renBtcAddress: await deposit.gatewayAddress(),
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

// const;

// const initConvertToEthereum = useCallback(
//   async function (tx: Transaction) {
//     const {
//       id,
//       params,
//       awaiting,
//       renResponse,
//       renSignature,
//       error,
//       sourceTxHash,
//       sourceTxVOut,
//     } = tx;

//     const pending = convertPendingConvertToEthereum;
//     if (pending.indexOf(id) < 0) {
//       setConvertPendingConvertToEthereum(pending.concat([id]));
//     }

//     // completed
//     if (!awaiting) return;

//     // clear error when re-attempting
//     if (error) {
//       updateTx({ ...tx, error: false });
//     }

//     // ren already exposed a signature
//     if (renResponse && renSignature) {
//       completeConvertToEthereum(tx).catch(console.error);
//     } else {
//       // create or re-create shift in
//       const mint = await initMint(tx);

//       if (!params) {
//         addTx({
//           ...tx,
//           // @ts-ignore: property 'params' is private (TODO)
//           params: mint.params,
//           renBtcAddress: await mint.gatewayAddress(),
//         });
//       }

//       // wait for btc
//       const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;
//       let deposit: LockAndMint;
//       if (
//         awaiting === "ren-settle" &&
//         sourceTxHash &&
//         String(sourceTxVOut) !== "undefined"
//       ) {
//         deposit = await mint.wait(targetConfs, {
//           txHash: sourceTxHash,
//           // TODO: Can vOut be casted to number safely?
//           vOut: sourceTxVOut as number,
//         });
//       } else {
//         deposit = await mint
//           .wait(
//             targetConfs,
//             sourceTxHash && String(sourceTxVOut) !== "undefined"
//               ? {
//                   txHash: sourceTxHash,
//                   // TODO: Can vOut be casted to number safely?
//                   vOut: sourceTxVOut as number,
//                 }
//               : // TODO: should be undefined?
//                 ((null as unknown) as undefined)
//           )
//           .on("deposit", (dep) => {
//             if (dep.utxo) {
//               if (awaiting === "btc-init") {
//                 setShowGatewayModal(false);
//                 setGatewayModalTx(null);

//                 updateTx({
//                   ...tx,
//                   awaiting: "btc-settle",
//                   btcConfirmations: dep.utxo.confirmations,
//                   sourceTxHash: dep.utxo.txHash,
//                   sourceTxVOut: dep.utxo.vOut,
//                 });
//               } else {
//                 updateTx({
//                   ...tx,
//                   btcConfirmations: dep.utxo.confirmations,
//                   sourceTxHash: dep.utxo.txHash,
//                   sourceTxVOut: dep.utxo.vOut,
//                 });
//               }
//             }
//           });
//       }

//       // @ts-ignore: (combination of !== and || is wrong) (TODO)
//       if (awaiting !== "eth-init" || awaiting !== "eth-settle") {
//         updateTx({ ...tx, awaiting: "ren-settle" });
//       }

//       try {
//         const signature = await deposit.submit();
//         updateTx({
//           ...tx,
//           // @ts-ignore: `renVMResponse` is private (TODO)
//           renResponse: signature.renVMResponse,
//           renSignature: signature.signature,
//         });

//         completeConvertToEthereum(tx).catch(console.error);
//       } catch (e) {
//         console.error("renvm submit error", e);
//       }
//     }
//   },
//   [
//     addTx,
//     completeConvertToEthereum,
//     convertPendingConvertToEthereum,
//     setConvertPendingConvertToEthereum,
//     setGatewayModalTx,
//     setShowGatewayModal,
//     updateTx,
//   ]
// );
