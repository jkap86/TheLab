const initialState = {
  column2: "FP",
  column3: "Lm Record",
  column4: "Lm FP",
  column5: "Record",
  itemActive: "",
  page: 1,
  searched: "",
  sortBy: {
    column: 2,
    asc: false,
  },
};

const LeaguemateLeaguesReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_LEAGUEMATE_LEAGUES":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default LeaguemateLeaguesReducer;
