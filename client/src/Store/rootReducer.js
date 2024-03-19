import { combineReducers } from "redux";
import homepageReducer from "../Components/Homepage/redux/homepageReducer";
import progressReducer from "../Components/Common/Redux/progressReducer";
import userReducer from "../Components/Common/Redux/userReducer";
import commonReducer from "../Components/Common/Redux/commonReducer";
import leaguesReducer from "../Components/Leagues/redux/leaguesReducer";
import StandingsReducer from "../Components/Common/Redux/StandingsReducer";
import PlayersReducer from "../Components/Players/redux/PlayersReducer";

const rootReducer = combineReducers({
  homepage: homepageReducer,
  progress: progressReducer,
  common: commonReducer,
  standings: StandingsReducer,
  user: userReducer,
  leagues: leaguesReducer,
  players: PlayersReducer,
});

export default rootReducer;
