import { combineReducers } from "redux";
import homepageReducer from "../Components/Homepage/redux/homepageReducer";
import progressReducer from "../Components/Common/Redux/progressReducer";
import userReducer from "../Components/Common/Redux/userReducer";
import commonReducer from "../Components/Common/Redux/commonReducer";

const rootReducer = combineReducers({
  homepage: homepageReducer,
  progress: progressReducer,
  common: commonReducer,
  user: userReducer,
});

export default rootReducer;
