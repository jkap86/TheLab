import { combineReducers } from "redux";
import LeaguematesPrimaryReducer from "./LeaguematesPrimaryReducer";
import LeaguemateLeaguesReducer from "./LeaguemateLeaguesReducer";

const leaguematesReducer = combineReducers({
  primary: LeaguematesPrimaryReducer,
  leaguemate_leagues: LeaguemateLeaguesReducer,
});

export default leaguematesReducer;
