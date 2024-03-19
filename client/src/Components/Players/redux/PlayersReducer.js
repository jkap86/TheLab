import { combineReducers } from "redux";
import PlayersPrimaryReducer from "./PlayersPrimaryReducer";
import LeaguesOwnedReducer from "./LeaguesOwnedReducer";

const PlayersReducer = combineReducers({
  primary: PlayersPrimaryReducer,
  owned: LeaguesOwnedReducer,
});

export default PlayersReducer;
