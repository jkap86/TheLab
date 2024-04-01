const initialState = {
  column2: "Lm Rank D",
  column3: "Lm Rank R",
  column4: "Rank D",
  column5: "Rank R",
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
