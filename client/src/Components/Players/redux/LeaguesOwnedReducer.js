const initialState = {
  page: 1,
  itemActive: "",
  searched: "",
  column2: "Picks Rank",
  column3: "Players Rank D",
  column4: "Rank D",
  column5: "Rank R",
  sortBy: {
    column: 2,
    asc: true,
  },
};

const LeaguesOwnedReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_LEAGUES_OWNED":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default LeaguesOwnedReducer;
