import RenSDK from "@renproject/ren";
import WalletConnectProvider from "@walletconnect/web3-provider";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import Web3Modal from "web3modal";
import { useState } from "react";

import BTC from "../assets/tokens/btc.png";
import DAI from "../assets/tokens/dai.png";
import ETH from "../assets/tokens/eth.png";
import USDC from "../assets/tokens/usdc.png";
import WBTC from "../assets/tokens/wbtc.png";
import ZEC from "../assets/tokens/zec.jpg";
import { getStore } from "../services/storeService";
import { Transaction } from "../types/transaction";
import erc20ABI from "./ABIs/erc20ABI.json";
import { getUser } from "./firebase/firebaseUtils";
import { gatherFeeData, initMonitoring } from "./txUtils";
import { ADAPTER_MAIN, ADAPTER_TEST, WBTC_MAIN, WBTC_TEST } from "./web3Utils";

let walletDataInterval: NodeJS.Timeout | null = null;

export const NAME_MAP = {
  btc: "Bitcoin",
  eth: "Ethereum",
  zec: "Zcash",
  dai: "DAI",
  usdc: "USDC",
  wbtc: "Wrapped Bitcoin",
};

export const MINI_ICON_MAP = {
  btc: BTC,
  eth: ETH,
  zec: ZEC,
  dai: DAI,
  usdc: USDC,
  wbtc: WBTC,
};

const updateAllowance = async () => {
  const store = getStore();

  const web3 = store.get("localWeb3");
  const walletAddress = store.get("localWeb3Address");
  const adapterAddress = store.get("convert.adapterAddress");
  const wbtcAddress = store.get("wbtcAddress");

  if (!web3 || !walletAddress) {
    return;
  }

  const contract = new web3.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
  const allowance = await contract.methods
    .allowance(walletAddress, adapterAddress)
    .call();

  store.set(
    "convert.adapterWbtcAllowance",
    Number(parseInt(allowance.toString()) / 10 ** 8).toFixed(8),
  );
};

export const setWbtcAllowance = async () => {
  const store = getStore();
  const walletAddress = store.get("localWeb3Address");
  const web3 = store.get("localWeb3");
  const adapterAddress = store.get("convert.adapterAddress");
  const wbtcAddress = store.get("wbtcAddress");

  const contract = new web3!.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
  store.set("convert.adapterWbtcAllowanceRequesting", true);
  try {
    await contract.methods
      .approve(adapterAddress, web3!.utils.toWei("1000000000000000000"))
      .send({
        from: walletAddress,
      });
    updateAllowance().catch(console.error);
    store.set("convert.adapterWbtcAllowanceRequesting", false);
  } catch (e) {
    console.error(e);
    store.set("convert.adapterWbtcAllowanceRequesting", false);
  }
};

const updateBalance = async () => {
  const store = getStore();

  const web3 = store.get("localWeb3");
  const walletAddress = store.get("localWeb3Address");
  const wbtcAddress = store.get("wbtcAddress");

  if (!web3 || !walletAddress) {
    return;
  }

  const contract = new web3.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
  const balance = await contract.methods.balanceOf(walletAddress).call();

  store.set(
    "wbtcBalance",
    Number(parseInt(balance.toString()) / 10 ** 8).toFixed(8),
  );
};

const watchWalletData = async () => {
  if (walletDataInterval) {
    clearInterval(walletDataInterval);
  }
  await updateAllowance();
  await updateBalance();
  walletDataInterval = setInterval(async () => {
    await updateAllowance();
    await updateBalance();
  }, 10 * 1000);
};

export const initDataWeb3 = async () => {
  const store = getStore();
  const network = store.get("selectedNetwork");
  store.set(
    "dataWeb3",
    new Web3(
      `https://${
        network === "testnet" ? "kovan" : "mainnet"
      }.infura.io/v3/6de9092ee3284217bb744cc1a6daab94`,
    ),
  );
};

const getSignatures = async (address: string, web3: Web3) => {
  const localSigMap = localStorage.getItem("sigMap");
  const addressLowerCase = address.toLowerCase();
  const localSigMapData = localSigMap ? JSON.parse(localSigMap) : {};
  let signature: string | null;
  if (localSigMapData[addressLowerCase]) {
    signature = localSigMapData[addressLowerCase];
  } else {
    // get unique wallet signature for firebase backup
    const sig = await web3.eth.personal.sign(
      web3.utils.utf8ToHex("Signing in to WBTC Cafe"),
      addressLowerCase,
      "",
    );
    signature = web3.utils.sha3(sig);
    localSigMapData[addressLowerCase] = signature;
    localStorage.setItem("sigMap", JSON.stringify(localSigMapData));
  }
  return signature;
};

const [disclosureAccepted, setDisclosureAccepted] = useState(false);

export const initLocalWeb3 = async () => {
  const store = getStore();
  const selectedNetwork = store.get("selectedNetwork");
  const db = store.get("db");
  const providerOptions = {
    walletconnect: {
      package: WalletConnectProvider, // required
      options: {
        infuraId: "6de9092ee3284217bb744cc1a6daab94", // required
      },
    },
  };

  const web3Modal = new Web3Modal({
    network: selectedNetwork === "testnet" ? "kovan" : "mainnet", // optional
    cacheProvider: false, // optional
    providerOptions, // required
  });

  const provider = await web3Modal.connect();
  const web3 = new Web3(provider);
  const currentProvider = web3.currentProvider;
  if (typeof currentProvider === "string") return;
  if (!currentProvider) return;
  const accounts = await web3.eth.getAccounts();
  const address = accounts[0];
  const addressLowerCase = address.toLowerCase();

  store.set("walletConnectError", false);

  let network = "";
  const netId = await web3.eth.net.getId();
  if (netId === 1) {
    network = "mainnet";
  } else if (netId === 42) {
    network = "testnet";
  }

  if (network !== selectedNetwork) {
    store.set("showNetworkModal", true);
    return;
  }

  store.set("localWeb3", web3);
  store.set("localWeb3Address", address);

  // recover from localStorage
  const lsData = localStorage.getItem("convert.transactions");

  const lsTransactions = lsData
    ? JSON.parse(lsData).filter(
        (tx: Transaction) => tx.localWeb3Address === addressLowerCase,
      )
    : [];

  try {
    store.set("loadingTransactions", true);

    if (!disclosureAccepted) {
      const ok = window.confirm(
        `Please take note that this is beta software and is provided on an "as is" and "as available" basis. WBTC Cafe does not give any warranties and will not be liable for any loss, direct or indirect through continued use of this site.`,
      );

      setDisclosureAccepted(ok);

      if (!ok) {
        throw new Error("Disclosure declined");
      }
    }

    const signature = await getSignatures(address, web3);
    if (!signature) {
      throw new Error("couldn't sign");
    }

    // get from local storage if user has signed in already

    store.set("fsSignature", signature);

    // auth with firestore

    store.set(
      "fsUser",
      await getUser(addressLowerCase, "wbtc.cafe", signature),
    );

    const fsDataSnapshot = await db
      .collection("transactions")
      .where("walletSignature", "==", signature)
      .get();

    const fsTransactions: Transaction[] = [];
    if (!fsDataSnapshot.empty) {
      fsDataSnapshot.forEach((doc) => {
        const tx: Transaction = JSON.parse(doc.data().data);
        fsTransactions.push(tx);
      });
    }
    const fsIds = fsTransactions.map((f) => f.id);

    const uniqueLsTransactions = lsTransactions.filter(
      (ltx: Transaction) => fsIds.indexOf(ltx.id) < 0,
    );
    const transactions = fsTransactions.concat(uniqueLsTransactions);
    store.set("convert.transactions", transactions);

    store.set("fsEnabled", true);
    store.set("loadingTransactions", false);

    watchWalletData().catch(console.error);
    gatherFeeData().catch(console.error);
    initMonitoring();

    if ((currentProvider as any)?.on) {
      // listen for changes
      (currentProvider as any).on("accountsChanged", async () => {
        window.location.reload();
      });

      (currentProvider as any).on("chainChanged", async () => {
        window.location.reload();
      });

      (currentProvider as any).on("networkChanged", async () => {
        window.location.reload();
      });
    }
  } catch (e) {
    store.set("loadingTransactions", false);
    store.set("walletConnectError", true);
    console.error(e);
  }

  return;
};

const setAddresses = async () => {
  const store = getStore();
  const network = store.get("selectedNetwork");
  if (network === "testnet") {
    store.set("convert.adapterAddress", ADAPTER_TEST);
    store.set("wbtcAddress", WBTC_TEST);
  } else {
    store.set("convert.adapterAddress", ADAPTER_MAIN);
    store.set("wbtcAddress", WBTC_MAIN);
  }
};

export const setNetwork = async function (network: string) {
  const store = getStore();
  store.set("selectedNetwork", network);
  store.set("sdk", new RenSDK(network));

  setAddresses
    // @ts-ignore: `this` implicitly has type `any` (TODO)
    .bind(this as any)()
    .catch(console.error);
};
