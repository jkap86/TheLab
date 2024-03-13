const initialState = {
  page: 1,
  itemActive: "",
  searched: "",
  tabSecondary: "Standings",
  column2: "Picks Rank",
  column3: "Players Rank D",
  column4: "Rank D",
  column5: "Rank R",
  sortBy: {
    column: 1,
    asc: true,
  },
};

const LeaguesCheckReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_LEAGUES_CHECK":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default LeaguesCheckReducer;
