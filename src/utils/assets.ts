import BTC from "../assets/tokens/btc.png";
import WBTC from "../assets/tokens/wbtc.png";

export enum Asset {
  BTC = "btc",
  WBTC = "wbtc",
  renBTC = "renbtc",
}

export const NAME_MAP = {
  [Asset.BTC]: "Bitcoin",
  [Asset.WBTC]: "Wrapped Bitcoin",
  [Asset.renBTC]: "renBTC",
};

export const MINI_ICON_MAP = {
  [Asset.BTC]: BTC,
  [Asset.WBTC]: WBTC,
  [Asset.renBTC]: BTC,
};
