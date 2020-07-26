import firebase from "firebase/app";

if (!process.env.REACT_APP_FB_KEY) {
  console.warn(`No database key set.`);
}

firebase.initializeApp({
  apiKey: process.env.REACT_APP_FB_KEY,
  authDomain: window.location.hostname,
  projectId: "wbtc-portal",
});

require("firebase/firestore");
// firebase.firestore().enablePersistence()

export const initFirebase = () => firebase.firestore();
