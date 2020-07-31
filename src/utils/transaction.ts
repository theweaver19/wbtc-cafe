import { Transaction } from "../types/transaction";
import { EthArgs } from "@renproject/interfaces";
import { Asset } from "./assets";
import RenJS from "@renproject/ren";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import adapterABI from "../utils/ABIs/adapterCurveABI.json";

interface TransactionEvent {
  event:
    | "restored" // Has been persisted, but could be in any state
    | "created" // Created locally, but no external calls
    | "initialized" // External calls made, but not completed
    | "accepted" // External calls made and accepted by RenVM
    | "confirmed"; // Accepted by RenVM and confirmed by source Network
  context: any;
}

export const handleEvent = async (
  tx: Transaction,
  event: TransactionEvent
): Promise<Transaction> => {
  switch (event.event) {
    case "restored":
      switch (tx.awaiting) {
        case "btc-init":
          return handleEvent(tx, { ...event, event: "created" });
        case "ren-settle":
          return handleEvent(tx, { ...event, event: "initialized" });
      }
    case "created":
      if (tx.type == "convert") {
        if (tx.sourceAsset == Asset.BTC) {
          return initializeMinting(tx, event.context);
        }
        if (tx.sourceNetwork === "ethereum") {
          return initializeBurning(tx);
        }
      }
    case "initialized":
      if (tx.type == "convert") {
        // doesn't quite make sense because we need the deposit txHash to continue
        return getRenVMResponse(tx, event.context);
      }

    case "accepted":
      return waitForDeposit(tx, event.context);

    case "confirmed":
      // Need to break this up so that we don't need to wait for the method to confirm
      return submitToEthereum(tx, event.context);
  }

  return tx;
};

interface MintingContext {
  sdk: RenJS;
  adapterAddress: string;
  localWeb3Address: string;
  localWeb3: Web3;
  targetConfs: number;
  exchangeRate: number;
  convertAdapterAddress: string;
}

const submitToEthereum = async (
  tx: Transaction,
  context: MintingContext
): Promise<Transaction> => {
  const {
    localWeb3,
    localWeb3Address,
    exchangeRate,
    convertAdapterAddress,
  } = context;

  const { id, params, renSignature, renResponse, minExchangeRate } = tx;

  const adapterContract = new localWeb3!.eth.Contract(
    adapterABI as AbiItem[],
    convertAdapterAddress
  );

  let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
  if (/* approveSwappedAsset === */ Asset.WBTC) {
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
        renResponse.autogen.amount,
        renResponse.autogen.nhash,
        renSignature
      )
      .send({
        from: localWeb3Address,
      })
      .on("transactionHash", (hash: string) => {
        const newTx = { ...tx, destTxHash: hash, error: false };
        return newTx;
        // monitorMintTx(newTx).catch(console.error);
      });
  } catch (error) {}

  return tx;
};

const renLockAndMint = (tx: Transaction, context: MintingContext) => {
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
          .value(minExchangeRate!, Asset.BTC)
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

const waitForDeposit = async (tx: Transaction, context: MintingContext) => {
  // Technically, we won't ever have the sourceTx here, as it only gets set here
  // const {sourceTxHash, sourceTxVOut} = tx;
  // if (!sourceTxHash || !sourceTxVOut) {
  //   return { ...tx, error: true };
  // }

  const { targetConfs } = context;
  return new Promise<Transaction>((resolve) => {
    renLockAndMint(tx, context)
      .wait(targetConfs, undefined)
      .on("deposit", (dep) => {
        resolve({
          ...tx,
          awaiting: "btc-settle",
          sourceTxHash: dep.utxo.txHash,
          sourceTxVOut: dep.utxo.vOut,
        });
      });
  });
};

// not sure if we need this as we should already have the responses...
// Wait for a mint response, but do not submit, as we already have a tx tracked by renvm
const getRenVMResponse = async (tx: Transaction, context: MintingContext) => {
  // Should always have these if waiting for a response
  if (!tx.sourceTxHash || !tx.sourceTxVOut) {
    return { ...tx, error: true };
  }
  const mint = renLockAndMint(tx, context);

  // @ts-ignore: `renVMResponse` is private (TODO)
  const { renVMResponse, signature } = await mint.wait(context.targetConfs, {
    txHash: tx.sourceTxHash,
    vOut: tx.sourceTxVOut as number,
  });
  return {
    ...tx,
    awaiting: "btc-settle",
    renResponse: renVMResponse,
    renSignature: signature,
  };
};

// Submit a mint request
const initializeMinting = async (tx: Transaction, context: MintingContext) => {
  const deposit = renLockAndMint(tx, context);
  try {
    // @ts-ignore: `renVMResponse` is private (TODO)
    const { renVMResponse, signature } = await deposit.submit();
    return {
      ...tx,
      awaiting: "btc-settle",
      renResponse: renVMResponse,
      renSignature: signature,
    };
  } catch (error) {
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
