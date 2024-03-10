const initialState = {
  page: 1,
  itemActive: "",
  searched: "",
  tabSecondary: "Standings",
  column1: "Picks Rank",
  column2: "Players Rank D",
  column3: "Rank D",
  column4: "Rank R",
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
