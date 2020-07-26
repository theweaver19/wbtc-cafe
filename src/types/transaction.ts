import firebase from "firebase";

export interface Transaction {
  id: string;
  type: string;
  instant: boolean;
  awaiting: string;
  sourceAsset: string;
  sourceAmount: string | number;
  sourceNetwork: string;
  sourceNetworkVersion: string;
  destAddress: string;
  destNetwork: string;
  destNetworkVersion: string;
  destAsset: string;
  amount: string | number;
  error: boolean;
  minExchangeRate?: string | number;
  maxSlippage: number;
  minSwapProceeds: number;
  adapterAddress: string;
  localWeb3Address: string;

  // Optional
  exchangeRateOnSubmit?: string;
  destTxConfs?: number;
  destTxHash?: string;
  swapReverted?: boolean;
  sourceTxHash?: string;
  sourceTxVOut?: string | number;
  sourceTxConfs?: number;
  renBtcAddress?: string;
  btcConfirmations?: number;
  created?: firebase.firestore.Timestamp;
  updated?: firebase.firestore.Timestamp;
  renResponse?: any;
  renSignature?: any;
  params?: any;
}