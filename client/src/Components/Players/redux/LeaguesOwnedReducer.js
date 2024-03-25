const initialState = {
  page: 1,
  itemActive: "",
  searched: "",
  column2: "Rank D",
  column3: "Rank R",
  column4: "Players Rank D",
  column5: "Picks Rank",
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
