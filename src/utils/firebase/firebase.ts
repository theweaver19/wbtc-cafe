import firebase from "firebase/app";

import { FB_KEY } from "../environmentVariables";

if (!FB_KEY) {
  console.warn(`No database key set.`);
}

firebase.initializeApp({
  apiKey: FB_KEY,
  authDomain: window.location.hostname,
  projectId: "wbtc-portal",
});

require("firebase/firestore");

export const initFirebase = () => firebase.firestore();
