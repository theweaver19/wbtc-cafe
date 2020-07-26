export interface Transaction {
  id: string;
  type: string;
  instant: boolean;
  awaiting: string;
  sourceAsset: string;
  sourceAmount: string;
  sourceNetwork: string;
  sourceNetworkVersion: string;
  sourceTxHash?: string;
  sourceTxConfs?: number;
  destAddress: string;
  destNetwork: string;
  destNetworkVersion: string;
  destAsset: string;
  destTxHash: string;
  destTxConfs: number;
  amount: string | number;
  error: boolean;
  swapReverted: boolean;
  minExchangeRate: string | number;
  maxSlippage: number;
  minSwapProceeds: number;
  exchangeRateOnSubmit: string;
  adapterAddress: string;
  localWeb3Address: string;

  renBtcAddress?: string;
}
