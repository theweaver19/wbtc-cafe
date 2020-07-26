let store = {};

export const getStore = function (): any {
  return store;
};

export const storeListener = function (newStore: any) {
  store = newStore;
};
