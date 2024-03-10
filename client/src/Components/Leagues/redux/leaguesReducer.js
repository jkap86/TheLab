import { combineReducers } from "redux";
import LeaguesCheckReducer from "./LeaguesCheckReducer";

const leaguesReducer = combineReducers({
  LeaguesCheck: LeaguesCheckReducer,
});

export default leaguesReducer;
