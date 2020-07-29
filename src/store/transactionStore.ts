import { EthArgs, UnmarshalledFees } from "@renproject/interfaces";
import RenJS from "@renproject/ren";
import { AbiItem } from "web3-utils";
import { LockAndMint } from "@renproject/ren/build/main/lockAndMint";
import { BurnAndRelease } from "@renproject/ren/build/main/burnAndRelease";
import { createContainer } from "unstated-next";
import { List } from "immutable";
import { useCallback, useEffect, useState } from "react";

import { Transaction } from "../types/transaction";
import adapterABI from "../utils/ABIs/adapterCurveABI.json";
import curveABI from "../utils/ABIs/curveABI.json";
import { Asset } from "../utils/assets";
import { CURVE_MAIN, CURVE_TEST } from "../utils/environmentVariables";
import { Store } from "./store";

function useTransactionStore() {
  const {
    db,
    fsEnabled,
    localWeb3Address,
    fsSignature,
    dataWeb3,
    selectedNetwork,
    fees,
    localWeb3,
    sdk,

    convertTransactions,
    convertAmount,
    convertSelectedDirection,
    convertPendingConvertToEthereum,
    convertAdapterAddress,

    setFees,
    setSwapRevertModalTx,
    setSwapRevertModalExchangeRate,
    setShowSwapRevertModal,
    setShowGatewayModal,
    setGatewayModalTx,

    setConvertTransactions,
    setConvertExchangeRate,
    setConvertRenVMFee,
    setConvertNetworkFee,
    setConvertConversionTotal,
    setConvertPendingConvertToEthereum,
  } = Store.useContainer();

  // Changing TX State
  const addTx = (tx: Transaction) => {
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
  };

  const updateTx = (newTx: Transaction): Transaction => {
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
  };

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

  const getTx = (id: Transaction["id"]) => {
    return convertTransactions.filter((t) => t.id === id).first(null);
  };

  const txExists = (tx: Transaction) => {
    return convertTransactions.filter((t) => t.id === tx.id).size > 0;
  };

  // External Data
  const updateRenVMFees = async () => {
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
      setFees(data);
    } catch (e) {
      console.error(e);
    }
  };

  const getFinalDepositExchangeRate = async (tx: Transaction) => {
    const { renResponse } = tx;

    const utxoAmountInSats = Number(renResponse.autogen.amount);
    const dynamicFeeRate = Number(fees![Asset.BTC].ethereum["mint"] / 10000);
    const finalAmount = Math.round(utxoAmountInSats * (1 - dynamicFeeRate));

    const curve = new dataWeb3!.eth.Contract(
      curveABI as AbiItem[],
      selectedNetwork === "testnet" ? CURVE_TEST : CURVE_MAIN,
    );
    try {
      const swapResult = await curve.methods.get_dy(0, 1, finalAmount).call();
      return Number(swapResult / finalAmount);
    } catch (e) {
      console.error(e);
    }
  };

  const gatherFeeData = async () => {
    const amount = convertAmount;
    const selectedDirection = convertSelectedDirection;
    const fixedFeeKey = selectedDirection ? "release" : "lock";
    const dynamicFeeKey = selectedDirection ? "burn" : "mint";

    const fixedFee = Number(fees![Asset.BTC][fixedFeeKey] / 10 ** 8);
    const dynamicFeeRate = Number(
      fees![Asset.BTC].ethereum[dynamicFeeKey] / 10000,
    );

    if (!amount || !dataWeb3 || !fees) return;

    try {
      let exchangeRate: number;
      let renVMFee: number;
      let total: number | string;
      const amountInSats = Math.round(
        RenJS.utils.value(amount, Asset.BTC).sats().toNumber(),
      );
      const curve = new dataWeb3.eth.Contract(
        curveABI as AbiItem[],
        selectedNetwork === "testnet" ? CURVE_TEST : CURVE_MAIN,
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
          RenJS.utils.value(amountAfterMint, Asset.BTC).sats().toNumber(),
        );

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

      setConvertExchangeRate(exchangeRate);
      setConvertRenVMFee(renVMFee);
      setConvertNetworkFee(fixedFee);
      setConvertConversionTotal(total);
    } catch (e) {
      console.error(e);
    }
  };

  // BTC to WBTC
  const monitorMintTx = async (tx: Transaction) => {
    const web3 = localWeb3;

    const interval = setInterval(async () => {
      // Get latest tx state every iteration
      const latestTx = getTx(tx.id) || tx;

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
            latestTx.destTxHash!,
          );

          // reverted because gas ran out
          if (
            (receipt && ((receipt.status as unknown) as string) === "0x0") ||
            receipt.status === false
          ) {
            updateTx(Object.assign(latestTx, { error: true, destTxHash: "" }));
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
        updateTx(Object.assign(latestTx, { error: true }));
        clearInterval(interval);
      }
    }, 1000);
  };

  const completeConvertToEthereum = async (
    transaction: Transaction,
    approveSwappedAsset?: string,
  ) => {
    const pending = convertPendingConvertToEthereum;
    const renResponse = transaction.renResponse;

    // amount user sent
    const userBtcTxAmount = Number(
      (renResponse.in.utxo.amount / 10 ** 8).toFixed(8),
    );
    // amount in renvm after fixed fee
    const utxoAmountSats = renResponse.autogen.amount;

    // update amount to the actual amount sent
    const tx = updateTx(
      Object.assign(transaction, { sourceAmount: userBtcTxAmount }),
    );

    const { id, params, renSignature, minExchangeRate } = tx;
    const adapterContract = new localWeb3!.eth.Contract(
      adapterABI as AbiItem[],
      convertAdapterAddress,
    );

    // if swap will revert to renBTC, let the user know before proceeding
    const exchangeRate = await getFinalDepositExchangeRate(tx);
    updateTx(Object.assign(tx, { exchangeRateOnSubmit: exchangeRate }));
    if (!approveSwappedAsset && exchangeRate! < minExchangeRate!) {
      setSwapRevertModalTx(tx.id);
      setSwapRevertModalExchangeRate(exchangeRate!.toFixed(8));
      setShowSwapRevertModal(true);
      updateTx(Object.assign(tx, { awaiting: "eth-init" }));
      return;
    }

    let newMinExchangeRate = params.contractCalls[0].contractParams[0].value;
    if (approveSwappedAsset === Asset.WBTC) {
      const rateMinusOne =
        RenJS.utils.value(exchangeRate!, Asset.BTC).sats().toNumber() - 1;
      newMinExchangeRate = rateMinusOne.toFixed(0);
    }

    if (!tx.destTxHash) {
      updateTx(Object.assign(tx, { awaiting: "eth-settle" }));
      try {
        await adapterContract.methods
          .mintThenSwap(
            params.contractCalls[0].contractParams[0].value,
            newMinExchangeRate,
            params.contractCalls[0].contractParams[1].value,
            params.contractCalls[0].contractParams[2].value,
            utxoAmountSats,
            renResponse.autogen.nhash,
            renSignature,
          )
          .send({
            from: localWeb3Address,
          })
          .on("transactionHash", (hash: string) => {
            const newTx = updateTx(
              Object.assign(tx, { destTxHash: hash, error: false }),
            );
            monitorMintTx(newTx).catch(console.error);
          });

        setConvertPendingConvertToEthereum(pending.filter((p) => p !== id));
      } catch (e) {
        console.error(e);
        updateTx(Object.assign(tx, { error: true }));
      }
    } else {
      const transaction = getTx(tx.id) || tx;
      monitorMintTx(transaction).catch(console.error);
    }
  };

  const initMint = (tx: Transaction) => {
    const {
      type,
      amount,
      params,
      destAddress,
      minExchangeRate,
      maxSlippage,
    } = tx;

    let adapterAddress = "";
    let contractFn = "";
    let contractParams: EthArgs = [];

    if (type === "convert") {
      adapterAddress = convertAdapterAddress;
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

    const mint = sdk!.lockAndMint(data);

    return mint;
  };

  const initConvertToEthereum = async function (tx: Transaction) {
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

    const pending = convertPendingConvertToEthereum;
    if (pending.indexOf(id) < 0) {
      setConvertPendingConvertToEthereum(pending.concat([id]));
    }

    // completed
    if (!awaiting) return;

    // clear error when re-attempting
    if (error) {
      updateTx(Object.assign(tx, { error: false }));
    }

    // ren already exposed a signature
    if (renResponse && renSignature) {
      completeConvertToEthereum(tx).catch(console.error);
    } else {
      // create or re-create shift in
      const mint = await initMint(tx);

      if (!params) {
        addTx({
          ...tx,
          // @ts-ignore: property 'params' is private (TODO)
          params: mint.params,
          renBtcAddress: await mint.gatewayAddress(),
        });
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
                ((null as unknown) as undefined),
          )
          .on("deposit", (dep) => {
            if (dep.utxo) {
              if (awaiting === "btc-init") {
                setShowGatewayModal(false);
                setGatewayModalTx(null);

                updateTx({
                  ...tx,
                  awaiting: "btc-settle",
                  btcConfirmations: dep.utxo.confirmations,
                  sourceTxHash: dep.utxo.txHash,
                  sourceTxVOut: dep.utxo.vOut,
                });
              } else {
                updateTx({
                  ...tx,
                  btcConfirmations: dep.utxo.confirmations,
                  sourceTxHash: dep.utxo.txHash,
                  sourceTxVOut: dep.utxo.vOut,
                });
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
        updateTx({
          ...tx,
          // @ts-ignore: `renVMResponse` is private (TODO)
          renResponse: signature.renVMResponse,
          renSignature: signature.signature,
        });

        completeConvertToEthereum(tx).catch(console.error);
      } catch (e) {
        console.error("renvm submit error", e);
      }
    }
  };

  // WBTC to BTC
  const monitorBurnTx = async (tx: Transaction) => {
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
      updateTx(Object.assign(tx, { error: true }));
      return;
    }

    const interval = setInterval(async () => {
      // Get latest tx state every iteration
      const latestTx = getTx(tx.id) || tx;

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
          updateTx(Object.assign(latestTx, { awaiting: "ren-settle" }));
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
  };

  const initConvertFromEthereum = async function (tx: Transaction) {
    const web3 = localWeb3;
    const adapterAddress = convertAdapterAddress;
    const walletAddress = localWeb3Address;
    const { amount, destAddress, minSwapProceeds } = tx;

    const from = walletAddress;
    const adapter = new web3!.eth.Contract(
      adapterABI as AbiItem[],
      adapterAddress,
    );

    if (!txExists(tx)) {
      addTx(tx);
    } else if (tx.error) {
      // clear error when re-attempting
      updateTx(Object.assign(tx, { error: false }));
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
            .toFixed(0),
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
      updateTx(Object.assign(tx, { error: true }));
      return;
    }
  };

  // On start-up
  const [monitoringStarted, setMonitoringStarted] = useState(false);
  const initMonitoringTrigger = useCallback(() => {
    setMonitoringStarted(true);
  }, [setMonitoringStarted]);

  useEffect(() => {
    if (!monitoringStarted) {
      return;
    }

    const network = selectedNetwork;
    const txs = convertTransactions.filter(
      (t) => t.sourceNetworkVersion === network,
    );

    txs.map((tx) => {
      if (tx.sourceNetwork === "bitcoin") {
        if (tx.destTxHash) {
          monitorMintTx(tx).catch(console.error);
        } else {
          initConvertToEthereum(tx).catch(console.error);
        }
      } else if (tx.sourceNetwork === "ethereum" && tx.awaiting && !tx.error) {
        monitorBurnTx(tx).catch(console.error);
      }
      return null;
    });
  }, [monitoringStarted]);

  return {
    updateTx,
    removeTx,
    updateRenVMFees,
    gatherFeeData,
    completeConvertToEthereum,
    initConvertToEthereum,
    initConvertFromEthereum,
    initMonitoringTrigger,
  };
}

export const TransactionStore = createContainer(useTransactionStore);
