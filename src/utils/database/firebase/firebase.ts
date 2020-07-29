import firebase from "firebase/app";

import { FB_KEY } from "../../environmentVariables";
import { Database } from "../database";
import { getFirebaseUser } from "./firebaseUtils";

if (!FB_KEY) {
  console.warn(`No database key set.`);
}

firebase.initializeApp({
  apiKey: FB_KEY,
  authDomain: window.location.hostname,
  projectId: "wbtc-portal",
});

require("firebase/firestore");

export class FireBase<Transaction extends { id: string }>
  implements Database<Transaction> {
  private db: firebase.firestore.Firestore;

  constructor() {
    this.db = firebase.firestore();
  }

  public addTx = async (
    tx: Transaction,
    localWeb3Address: string,
    fsSignature: string | null,
  ) => {
    // add timestamps
    const timestamp = firebase.firestore.Timestamp.fromDate(
      new Date(Date.now()),
    );

    await this.db
      .collection("transactions")
      .doc(tx.id)
      .set({
        user: localWeb3Address.toLowerCase(),
        walletSignature: fsSignature,
        id: tx.id,
        updated: timestamp,
        data: JSON.stringify({ ...tx, created: timestamp, updated: timestamp }),
      })
      .catch(console.error);
  };

  public updateTx = async (tx: Transaction) => {
    const timestamp = firebase.firestore.Timestamp.fromDate(
      new Date(Date.now()),
    );
    await this.db
      .collection("transactions")
      .doc(tx.id)
      .update({
        data: JSON.stringify({ ...tx, updated: timestamp }),
        updated: timestamp,
      });
  };

  public deleteTx = async (tx: Transaction) => {
    await this.db.collection("transactions").doc(tx.id).delete();
  };

  public getTxs = async (signature: string): Promise<Transaction[]> => {
    const fsDataSnapshot = await this.db
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

    return fsTransactions;
  };

  public getUser = async (address: string, signature: string) => {
    const user = await getFirebaseUser(address, "wbtc.cafe", signature);
    return (
      user && {
        uid: user.uid,
      }
    );
  };
}
