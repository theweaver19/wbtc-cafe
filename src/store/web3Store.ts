import RenSDK from "@renproject/ren";
import WalletConnectProvider from "@walletconnect/web3-provider";
import Web3 from "web3";
import { AbiItem } from "web3-utils";
import Web3Modal from "web3modal";
import { createContainer } from "unstated-next";

import { Transaction } from "../types/transaction";
import erc20ABI from "../utils/ABIs/erc20ABI.json";
import {
  ADAPTER_MAIN,
  ADAPTER_TEST,
  WBTC_MAIN,
  WBTC_TEST,
} from "../utils/environmentVariables";
import { getUser } from "../utils/firebase/firebaseUtils";
import { Store } from "./store";
import { TransactionStore } from "./transactionStore";

function useWeb3() {
  const {
    localWeb3,
    localWeb3Address,
    wbtcAddress,
    selectedNetwork,
    db,
    disclosureAccepted,
    convertAdapterAddress,

    setWalletConnectError,
    setShowNetworkModal,
    setLocalWeb3,
    setLocalWeb3Address,
    setLoadingTransactions,
    setDisclosureAccepted,
    setFsSignature,
    setFsEnabled,
    setWbtcAddress,
    setSelectedNetwork,
    setSdk,
    setWbtcBalance,
    setDataWeb3,
    setFsUser,
    setConvertAdapterWbtcAllowanceRequesting,
    setConvertTransactions,
    setConvertAdapterAddress,
    setConvertAdapterWbtcAllowance,
  } = Store.useContainer();

  const { gatherFeeData, initMonitoring } = TransactionStore.useContainer();

  let walletDataInterval: NodeJS.Timeout | null = null;

  const updateAllowance = async () => {
    const web3 = localWeb3;
    const walletAddress = localWeb3Address;
    const adapterAddress = convertAdapterAddress;

    if (!web3 || !walletAddress) {
      return;
    }

    const contract = new web3.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
    const allowance = await contract.methods
      .allowance(walletAddress, adapterAddress)
      .call();

    setConvertAdapterWbtcAllowance(
      Number(parseInt(allowance.toString()) / 10 ** 8).toFixed(8),
    );
  };

  const setWbtcAllowance = async () => {
    const walletAddress = localWeb3Address;
    const web3 = localWeb3;
    const adapterAddress = convertAdapterAddress;

    const contract = new web3!.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
    setConvertAdapterWbtcAllowanceRequesting(true);
    try {
      await contract.methods
        .approve(adapterAddress, web3!.utils.toWei("1000000000000000000"))
        .send({
          from: walletAddress,
        });
      updateAllowance().catch(console.error);
      setConvertAdapterWbtcAllowanceRequesting(false);
    } catch (e) {
      console.error(e);
      setConvertAdapterWbtcAllowanceRequesting(false);
    }
  };

  const updateBalance = async () => {
    const web3 = localWeb3;
    const walletAddress = localWeb3Address;

    if (!web3 || !walletAddress) {
      return;
    }

    const contract = new web3.eth.Contract(erc20ABI as AbiItem[], wbtcAddress);
    const balance = await contract.methods.balanceOf(walletAddress).call();

    setWbtcBalance(Number(parseInt(balance.toString()) / 10 ** 8).toFixed(8));
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

  const initDataWeb3 = async (network: string) => {
    const providedNetworkOrStore = network || selectedNetwork;
    setDataWeb3(
      new Web3(
        `https://${
          providedNetworkOrStore === "testnet" ? "kovan" : "mainnet"
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

  const initLocalWeb3 = async () => {
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

    setWalletConnectError(false);

    let network = "";
    const netId = await web3.eth.net.getId();
    if (netId === 1) {
      network = "mainnet";
    } else if (netId === 42) {
      network = "testnet";
    }

    if (network !== selectedNetwork) {
      setShowNetworkModal(true);
      return;
    }

    setLocalWeb3(web3);
    setLocalWeb3Address(address);

    // recover from localStorage
    const lsData = localStorage.getItem("convert.transactions");

    const lsTransactions = lsData
      ? JSON.parse(lsData).filter(
          (tx: Transaction) => tx.localWeb3Address === addressLowerCase,
        )
      : [];

    try {
      setLoadingTransactions(true);

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

      setFsSignature(signature);

      // auth with firestore

      setFsUser(await getUser(addressLowerCase, "wbtc.cafe", signature));

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
      setConvertTransactions(transactions);

      setFsEnabled(true);
      setLoadingTransactions(false);

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
      setLoadingTransactions(false);
      setWalletConnectError(true);
      console.error(e);
    }

    return;
  };

  const setAddresses = async () => {
    const network = selectedNetwork;
    if (network === "testnet") {
      setConvertAdapterAddress(ADAPTER_TEST);
      setWbtcAddress(WBTC_TEST);
    } else {
      setConvertAdapterAddress(ADAPTER_MAIN);
      setWbtcAddress(WBTC_MAIN);
    }
  };

  const setNetwork = async function (network: string) {
    setSelectedNetwork(network);
    setSdk(new RenSDK(network));

    setAddresses
      // @ts-ignore: `this` implicitly has type `any` (TODO)
      .bind(this as any)()
      .catch(console.error);
  };

  return {
    setWbtcAllowance,
    initDataWeb3,
    initLocalWeb3,
    setNetwork,
  };
}

export const Web3Store = createContainer(useWeb3);
