import { StoreInterface } from "../store/store";

let store = {};

export const getStore = (): StoreInterface => {
  // TODO: Can getStore be called when the store is '{}'?
  return store as StoreInterface;
};

export const storeListener = (newStore: StoreInterface) => {
  store = newStore;
};
