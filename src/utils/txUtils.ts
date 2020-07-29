import { EthArgs, UnmarshalledFees } from "@renproject/interfaces";
import RenJS from "@renproject/ren";
import firebase from "firebase/app";
import { AbiItem } from "web3-utils";
import { LockAndMint } from "@renproject/ren/build/main/lockAndMint";
import { BurnAndRelease } from "@renproject/ren/build/main/burnAndRelease";

import { getStore } from "../services/storeService";
import { Transaction } from "../types/transaction";
import adapterABI from "./ABIs/adapterCurveABI.json";
import curveABI from "./ABIs/curveABI.json";
import { CURVE_MAIN, CURVE_TEST } from "./web3Utils";

// Changing TX State
const addTx = (tx: Transaction) => {
  // add timestamps
  const timestamp = firebase.firestore.Timestamp.fromDate(new Date(Date.now()));
  tx.created = timestamp;
  tx.updated = timestamp;

  const store = getStore();
  const db = store.get("db");
  const fsEnabled = store.get("fsEnabled");
  const localWeb3Address = store.get("localWeb3Address");
  const fsSignature = store.get("fsSignature");
  const storeString = "convert.transactions";
  const txs = store.get(storeString);
  txs.push(tx);
  store.set(storeString, txs);

  // use localStorage
  localStorage.setItem(storeString, JSON.stringify(txs));

  // for debugging
  // window.txs = txs;

  if (fsEnabled) {
    try {
      db.collection("transactions")
        .doc(tx.id)
        .set({
          user: localWeb3Address.toLowerCase(),
          walletSignature: fsSignature,
          id: tx.id,
          updated: timestamp,
          data: JSON.stringify(tx),
        })
        .catch(console.error);
    } catch (e) {
      console.error(e);
    }
  }
};

export const updateTx = (newTx: Transaction): Transaction => {
  // update timestamp
  newTx.updated = firebase.firestore.Timestamp.fromDate(new Date(Date.now()));

  const store = getStore();
  const db = store.get("db");
  const fsEnabled = store.get("fsEnabled");
  const storeString = "convert.transactions";
  const txs = store.get(storeString).map((t) => {
    if (t.id === newTx.id) {
      // const newTx = Object.assign(t, props)
      return newTx;
    }
    return t;
  });
  store.set(storeString, txs);

  // use localStorage
  localStorage.setItem(storeString, JSON.stringify(txs));

  // for debugging
  // window.txs = txs;

  if (fsEnabled) {
    try {
      db.collection("transactions")
        .doc(newTx.id)
        .update({
          data: JSON.stringify(newTx),
          updated: newTx.updated,
        })
        .catch(console.error);
    } catch (e) {
      console.error(e);
    }
  }

  return newTx;
};

export const removeTx = (tx: Transaction) => {
  const store = getStore();
  const db = store.get("db");
  const fsEnabled = store.get("fsEnabled");
  const storeString = "convert.transactions";
  const txs = store.get(storeString).filter((t) => t.id !== tx.id);
  // console.log(txs)
  store.set(storeString, txs);

  // use localStorage
  localStorage.setItem(storeString, JSON.stringify(txs));

  // for debugging
  // window.txs = txs;

  if (fsEnabled) {
    try {
      db.collection("transactions").doc(tx.id).delete().catch(console.error);
    } catch (e) {
      console.error(e);
    }
  }
};

const getTx = (id: Transaction["id"]) => {
  return getStore()
    .get("convert.transactions")
    .filter((t) => t.id === id)[0];
};

const txExists = (tx: Transaction) => {
  return (
    getStore()
      .get("convert.transactions")
      .filter((t) => t.id === tx.id).length > 0
  );
};

// External Data
export const updateRenVMFees = async () => {
  const store = getStore();
  try {
    const fees = await fetch("https://lightnode-mainnet.herokuapp.com", {
      method: "POST", // or 'PUT'
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: 67,
        jsonrpc: "2.0",
        method: "ren_queryFees",
        params: {},
      }),
    });
    const data: UnmarshalledFees = (await fees.json()).result;
    // console.log(data)
    // console.log('renvm fees', await fees.json())
    store.set("fees", data);
  } catch (e) {
    console.error(e);
  }
};

const getFinalDepositExchangeRate = async (tx: Transaction) => {
  const store = getStore();
  const dataWeb3 = store.get("dataWeb3");
  const selectedNetwork = store.get("selectedNetwork");
  const fees = store.get("fees");
  const { renResponse } = tx;

  // const utxoAmount = renResponse.autogen.amount / (10 ** 8)

  // console.log('tx', tx)

  const utxoAmountInSats = Number(renResponse.autogen.amount);
  const dynamicFeeRate = Number(fees!["btc"].ethereum["mint"] / 10000);
  const finalAmount = Math.round(utxoAmountInSats * (1 - dynamicFeeRate));
  // console.log(finalAmount, dynamicFeeRate)

  const curve = new dataWeb3!.eth.Contract(
    curveABI as AbiItem[],
    selectedNetwork === "testnet" ? CURVE_TEST : CURVE_MAIN
  );
  try {
    const swapResult = await curve.methods.get_dy(0, 1, finalAmount).call();
    return Number(swapResult / finalAmount);
  } catch (e) {
    console.error(e);
  }
};

export const gatherFeeData = async () => {
  const store = getStore();
  const dataWeb3 = store.get("dataWeb3");
  const amount = store.get("convert.amount");
  const selectedNetwork = store.get("selectedNetwork");
  const fees = store.get("fees");
  const selectedAsset = store.get("selectedAsset");
  const selectedDirection = store.get("convert.selectedDirection");
  const fixedFeeKey = selectedDirection ? "release" : "lock";
  const dynamicFeeKey = selectedDirection ? "burn" : "mint";

  const fixedFee = Number(
    fees![selectedAsset as "btc" | "zec" | "bch"][fixedFeeKey] / 10 ** 8
  );
  const dynamicFeeRate = Number(
    fees![selectedAsset as "btc" | "zec" | "bch"].ethereum[dynamicFeeKey] /
      10000
  );

  if (!amount || !dataWeb3 || !fees) return;

  try {
    let exchangeRate: number;
    let renVMFee: number;
    let total: number | string;
    const amountInSats = Math.round(
      RenJS.utils.value(amount, "btc").sats().toNumber()
    );
    const curve = new dataWeb3.eth.Contract(
      curveABI as AbiItem[],
      selectedNetwork === "testnet" ? CURVE_TEST : CURVE_MAIN
    );

    // withdraw
    if (selectedDirection) {
      const swapResult =
        (await curve.methods.get_dy(1, 0, amountInSats).call()) / 10 ** 8;
      exchangeRate = Number(swapResult / Number(amount));
      renVMFee = Number(swapResult) * dynamicFeeRate;
      total =
        Number(swapResult - renVMFee - fixedFee) > 0
          ? Number(swapResult - renVMFee - fixedFee)
          : "0.000000";
    } else {
      renVMFee = Number(amount) * dynamicFeeRate;
      const amountAfterMint =
        Number(Number(amount) - renVMFee - fixedFee) > 0
          ? Number(Number(amount) - renVMFee - fixedFee)
          : 0;
      const amountAfterMintInSats = Math.round(
        RenJS.utils.value(amountAfterMint, "btc").sats().toNumber()
      );

      // console.log(amountAfterMintInSats, renVMFee, fixedFee)

      if (amountAfterMintInSats) {
        const swapResult =
          (await curve.methods.get_dy(0, 1, amountAfterMintInSats).call()) /
          10 ** 8;
        exchangeRate = Number(swapResult / amountAfterMint);
        total = Number(swapResult);
      } else {
        exchangeRate = Number(0);
        total = Number(0);
      }
    }

    store.set("convert.exchangeRate", exchangeRate);
    store.set("convert.renVMFee", renVMFee);
    store.set("convert.networkFee", fixedFee);
    store.set("convert.conversionTotal", total);
  } catch (e) {
    console.error(e);
  }
};

// export const getTaggedTxs = async () => {
//   const store = getStore();
//   const localWeb3Address = store.get("localWeb3Address");
//   try {
//     const res = await fetch("https://lightnode-testnet.herokuapp.com", {
//       method: "POST", // or 'PUT'
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         id: 67,
//         jsonrpc: "2.0",
//         method: "ren_queryTxs",
//         params: {
//           tags: [Base64.stringify(sha256(localWeb3Address))],
//         },
//       }),
//     });
//     // const data = await res.json();
//     // console.log(data)
//     // console.log('renvm fees', await fees.json())
//     // store.set('fees', data)
//   } catch (e) {
//     console.error(e);
//   }
// };

// BTC to WBTC
const monitorMintTx = async (tx: Transaction) => {
  const store = getStore();
  const web3 = store.get("localWeb3");

  const interval = setInterval(async () => {
    // Get latest tx state every iteration
    const latestTx = getTx(tx.id);
    // console.log('latestTx', latestTx)

    // Get transaction details
    const txDetails = await web3!.eth.getTransaction(latestTx.destTxHash!);
    if (txDetails) {
      const currentBlock = await web3!.eth.getBlockNumber();
      const confs =
        txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
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
          updateTx(
            Object.assign(latestTx, {
              error: true,
              destTxHash: "",
            })
          );
        } else {
          updateTx(
            Object.assign(latestTx, {
              destTxConfs: confs,
              awaiting: "",
              error: false,
            })
          );
        }

        clearInterval(interval);
      }
    } else {
      updateTx(
        Object.assign(latestTx, {
          error: true,
        })
      );
      clearInterval(interval);
    }
  }, 1000);
};

export const completeConvertToEthereum = async (
  transaction: Transaction,
  approveSwappedAsset?: string
) => {
  const store = getStore();
  const localWeb3 = store.get("localWeb3");
  const localWeb3Address = store.get("localWeb3Address");
  const pending = store.get("convert.pendingConvertToEthereum");
  const renResponse = transaction.renResponse;

  // amount user sent
  const userBtcTxAmount = Number(
    (renResponse.in.utxo.amount / 10 ** 8).toFixed(8)
  );
  // amount in renvm after fixed fee
  const utxoAmountSats = renResponse.autogen.amount;

  // update amount to the actual amount sent
  const tx = updateTx(
    Object.assign(transaction, { sourceAmount: userBtcTxAmount })
  );

  const { id, params, renSignature, minExchangeRate } = tx;
  const adapterContract = new localWeb3!.eth.Contract(
    adapterABI as AbiItem[],
    store.get("convert.adapterAddress")
  );

  // if swap will revert to renBTC, let the user know before proceeding
  const exchangeRate = await getFinalDepositExchangeRate(tx);
  updateTx(Object.assign(tx, { exchangeRateOnSubmit: exchangeRate }));
  // console.log(exchangeRate, minExchangeRate)
  if (!approveSwappedAsset && exchangeRate! < minExchangeRate!) {
    // console.log('showing modal')
    store.set("swapRevertModalTx", tx);
    store.set("swapRevertModalExchangeRate", exchangeRate!.toFixed(8));
    store.set("showSwapRevertModal", true);
    updateTx(Object.assign(tx, { awaiting: "eth-init" }));
    return;
  }

  let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
  if (approveSwappedAsset === "wbtc") {
    const rateMinusOne =
      RenJS.utils.value(exchangeRate!, "btc").sats().toNumber() - 1;
    newMinExchangeRate = rateMinusOne.toFixed(0);
  }

  if (!tx.destTxHash) {
    updateTx(
      Object.assign(tx, {
        awaiting: "eth-settle",
      })
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
          // console.log(hash)
          const newTx = updateTx(
            Object.assign(tx, {
              destTxHash: hash,
              error: false,
            })
          );
          monitorMintTx(newTx).catch(console.error);
        });

      store.set(
        "convert.pendingConvertToEthereum",
        pending.filter((p) => p !== id)
      );
    } catch (e) {
      console.error(e);
      updateTx(Object.assign(tx, { error: true }));
    }
  } else {
    monitorMintTx(getTx(tx.id)).catch(console.error);
  }
};

const initMint = (tx: Transaction) => {
  const {
    type,
    amount,
    params,
    destAddress,
    // minSwapProceeds,
    minExchangeRate,
    maxSlippage,
  } = tx;
  const store = getStore();
  const { sdk, localWeb3Address } = store.getState();

  let adapterAddress = "";
  let contractFn = "";
  let contractParams: EthArgs = [];

  if (type === "convert") {
    adapterAddress = store.get("convert.adapterAddress");
    contractFn = "mintThenSwap";
    contractParams = [
      {
        name: "_minExchangeRate",
        type: "uint256",
        value: RenJS.utils
          .value(minExchangeRate!, "btc")
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
      .value(amount, "btc")
      .sats()
      .toNumber()
      .toFixed(0),
    sendTo: adapterAddress,
    contractFn,
    contractParams,
    nonce: params && params.nonce ? params.nonce : RenJS.utils.randomNonce(),
    // tags: [Base64.stringify(sha256(localWeb3Address))]
  };

  // console.log('init mint', data, tx)
  const mint = sdk!.lockAndMint(data);

  return mint;
};

export const initConvertToEthereum = async function (tx: Transaction) {
  const store = getStore();
  const {
    id,
    params,
    awaiting,
    renResponse,
    renSignature,
    error,
    sourceTxHash,
    sourceTxVOut,
  } = tx;

  const pending = store.get("convert.pendingConvertToEthereum");
  if (pending.indexOf(id) < 0) {
    store.set("convert.pendingConvertToEthereum", pending.concat([id]));
  }

  // completed
  if (!awaiting) return;

  // clear error when re-attempting
  if (error) {
    updateTx(Object.assign(tx, { error: false }));
  }

  // ren already exposed a signature
  if (renResponse && renSignature) {
    // @ts-ignore: 'this' implicitly has type 'any' (TODO)
    completeConvertToEthereum.bind(this)(tx).catch(console.error);
  } else {
    // create or re-create shift in
    // @ts-ignore: 'this' implicitly has type 'any' (TODO)
    const mint = await initMint.bind(this)(tx);

    // console.log('initConvertToEthereum mint', mint, tx)

    if (!params) {
      addTx(
        Object.assign(tx, {
          // @ts-ignore: property 'params' is private (TODO)
          params: mint.params,
          renBtcAddress: await mint.gatewayAddress(),
        })
      );
    }

    // wait for btc
    const targetConfs = tx.sourceNetworkVersion === "testnet" ? 2 : 6;
    let deposit: LockAndMint;
    if (
      awaiting === "ren-settle" &&
      sourceTxHash &&
      String(sourceTxVOut) !== "undefined"
    ) {
      deposit = await mint.wait(targetConfs, {
        txHash: sourceTxHash,
        // TODO: Can vOut be casted to number safely?
        vOut: sourceTxVOut as number,
      });
    } else {
      // console.log('waiting for deposit')
      deposit = await mint
        .wait(
          targetConfs,
          sourceTxHash && sourceTxVOut
            ? {
                txHash: sourceTxHash,
                // TODO: Can vOut be casted to number safely?
                vOut: sourceTxVOut as number,
              }
            : // TODO: should be undefined?
              ((null as unknown) as undefined)
        )
        .on("deposit", (dep) => {
          // console.log('on deposit', dep)
          if (dep.utxo) {
            if (awaiting === "btc-init") {
              store.set("showGatewayModal", false);
              store.set("gatewayModalTx", null);

              updateTx(
                Object.assign(tx, {
                  awaiting: "btc-settle",
                  btcConfirmations: dep.utxo.confirmations,
                  sourceTxHash: dep.utxo.txHash,
                  sourceTxVOut: dep.utxo.vOut,
                })
              );
            } else {
              updateTx(
                Object.assign(tx, {
                  btcConfirmations: dep.utxo.confirmations,
                  sourceTxHash: dep.utxo.txHash,
                  sourceTxVOut: dep.utxo.vOut,
                })
              );
            }
          }
        });
    }

    // @ts-ignore: (combination of !== and || is wrong) (TODO)
    if (awaiting !== "eth-init" || awaiting !== "eth-settle") {
      updateTx(Object.assign(tx, { awaiting: "ren-settle" }));
    }

    try {
      const signature = await deposit.submit();
      updateTx(
        Object.assign(tx, {
          // @ts-ignore: `renVMResponse` is private (TODO)
          renResponse: signature.renVMResponse,
          renSignature: signature.signature,
        })
      );

      // @ts-ignore: 'this' implicitly has type 'any' (TODO)
      completeConvertToEthereum.bind(this)(tx).catch(console.error);
    } catch (e) {
      console.log("renvm submit error", e);
    }
  }
};

// WBTC to BTC
const monitorBurnTx = async (tx: Transaction) => {
  const store = getStore();
  const sdk = store.get("sdk");
  const web3 = store.get("localWeb3");
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
    updateTx(Object.assign(tx, { error: true }));
    return;
  }

  const interval = setInterval(async () => {
    // Get latest tx state every iteration
    const latestTx = getTx(tx.id);
    console.log("latestTx", latestTx, burn);

    // Get transaction details
    const txDetails = await web3!.eth.getTransaction(latestTx.sourceTxHash!);
    const currentBlock = await web3!.eth.getBlockNumber();
    const confs =
      txDetails.blockNumber === null || txDetails.blockNumber > currentBlock
        ? 0
        : currentBlock - txDetails.blockNumber;

    // Update confs
    if (confs !== latestTx.sourceTxConfs) {
      updateTx(Object.assign(latestTx, { sourceTxConfs: confs }));
    }

    // After enough confs, start watching RenVM
    if (latestTx.sourceTxConfs! >= targetConfs) {
      if (latestTx.awaiting === "eth-settle") {
        updateTx(
          Object.assign(latestTx, {
            awaiting: "ren-settle",
          })
        );
      }

      try {
        const renVMTx = await burn.queryTx();
        // console.log('renVMTx', renVMTx)
        if (renVMTx.txStatus === "done") {
          updateTx(
            Object.assign(latestTx, {
              awaiting: "",
              error: false,
            })
          );
          clearInterval(interval);
        }
      } catch (e) {
        console.error(e);
      }
    }
  }, 1000);
};

export const initConvertFromEthereum = async function (tx: Transaction) {
  const store = getStore();
  const web3 = store.get("localWeb3");
  const adapterAddress = store.get("convert.adapterAddress");
  const walletAddress = store.get("localWeb3Address");
  const { amount, destAddress, minSwapProceeds } = tx;

  const from = walletAddress;
  const adapter = new web3!.eth.Contract(
    adapterABI as AbiItem[],
    adapterAddress
  );

  // @ts-ignore: 'this' implicitly has type 'any' (TODO)
  if (!txExists.bind(this)(tx)) {
    addTx(tx);
  } else if (tx.error) {
    // clear error when re-attempting
    updateTx(Object.assign(tx, { error: false }));
  }

  try {
    await adapter.methods
      .swapThenBurn(
        RenJS.utils.BTC.addressToHex(destAddress), //_to
        RenJS.utils.value(amount, "btc").sats().toNumber().toFixed(0), // _amount in Satoshis
        RenJS.utils.value(minSwapProceeds, "btc").sats().toNumber().toFixed(0)
      )
      .send({ from })
      .on("transactionHash", (hash: string) => {
        // console.log(hash)
        updateTx(
          Object.assign(tx, {
            awaiting: "eth-settle",
            sourceTxHash: hash,
            error: false,
          })
        );
        monitorBurnTx(getTx(tx.id)).catch(console.error);
      });
  } catch (e) {
    console.log("eth burn error", e);
    updateTx(Object.assign(tx, { error: true }));
    return;
  }
};

// On start-up
export const initMonitoring = function () {
  const store = getStore();
  const network = store.get("selectedNetwork");
  const txs = store
    .get("convert.transactions")
    .filter((t) => t.sourceNetworkVersion === network);

  txs.map((tx) => {
    if (tx.sourceNetwork === "bitcoin") {
      if (tx.destTxHash) {
        monitorMintTx(tx).catch(console.error);
      } else {
        // @ts-ignore: 'this' implicitly has type 'any' (TODO)
        initConvertToEthereum.bind(this)(tx).catch(console.error);
      }
    } else if (tx.sourceNetwork === "ethereum" && tx.awaiting && !tx.error) {
      monitorBurnTx(tx).catch(console.error);
    }
    return null;
  });
};
