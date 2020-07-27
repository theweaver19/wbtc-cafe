import BTC from "../assets/tokens/btc.png";
import WBTC from "../assets/tokens/wbtc.png";
import { Asset } from "../types/enums";

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
