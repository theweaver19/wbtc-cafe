import firebase from "firebase/app";

require("firebase/auth");
require("firebase/firestore");

// Creates a user profile that is used for authenticating provision
// to transaction records
// FIXME: don't think this approach really provides value as a user can only ever have one signature
const createProfileData = async (
  db: firebase.firestore.Firestore,
  signature: string,
  uid: string,
) => {
  // update user collection
  const doc = db.collection("users").doc(uid);
  const docData = await doc.get();
  if (docData.exists) {
    const data = docData.data();
    if (data && data.signatures.indexOf(signature) < 0) {
      // add a new signature if needed
      await doc.update({
        signatures: data.signatures.concat([signature]),
        updated: firebase.firestore.Timestamp.fromDate(new Date(Date.now())),
      });
    }
  } else {
    // create user
    await doc.set({
      uid,
      updated: firebase.firestore.Timestamp.fromDate(new Date(Date.now())),
      signatures: [signature],
    });
  }
};

// Check if an account exists for the given id and signature,
// otherwise attempt to register
const signInOrRegister = async (
  id: string,
  signature: string,
): Promise<firebase.User | null> => {
  console.log(id, signature);
  try {
    const { user } = await firebase
      .auth()
      .signInWithEmailAndPassword(id, signature);
    if (user) return user;
  } catch (e) {
    // FIXME: we should probably handle wrong signatures here, as it would imply
    // some sort of corruption or attack.
    console.error(e);
  }
  const { user } = await firebase
    .auth()
    .createUserWithEmailAndPassword(id, signature);
  if (!user) return null;
  await createProfileData(firebase.firestore(), signature, user.uid);
  return user;
};

// Check if the user is currently authenticated for the correct address,
// otherwise attempt to sign in or register for that address
export const getUser = async (
  address: string,
  host: string,
  signature: string,
) => {
  const id = `${address.toLowerCase()}@${host}`;
  const { currentUser } = firebase.auth();

  if (!currentUser || currentUser.email !== id) {
    return signInOrRegister(id, signature);
  } else {
    return currentUser;
  }
};
