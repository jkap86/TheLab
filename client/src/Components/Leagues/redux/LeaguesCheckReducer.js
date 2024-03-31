const initialState = {
  page: 1,
  itemActive: "",
  searched: "",
  column2: "Rank D",
  column3: "Rank D Starters",
  column4: "Rank R",
  column5: "Rank R Starters",
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
