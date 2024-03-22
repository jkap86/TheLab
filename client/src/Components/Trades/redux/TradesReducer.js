import { combineReducers } from "redux";
import LmTradesReducer from "./LmTradesReducer";
import PcTradesReducer from "./PcTradesReducer";
import TradesNavReducer from "./TradesNavReducer";

const TradesReducer = combineReducers({
  nav: TradesNavReducer,
  lmtrades: LmTradesReducer,
  pctrades: PcTradesReducer,
});

export default TradesReducer;
