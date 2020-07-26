import firebase from "firebase/app";

firebase.initializeApp({
  apiKey: process.env.REACT_APP_FB_KEY,
  authDomain: window.location.hostname,
  projectId: "wbtc-portal",
});

require("firebase/firestore");
// firebase.firestore().enablePersistence()

export const initFirebase = () => firebase.firestore();
