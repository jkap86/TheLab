const initialState = {
  page: 1,
  page_owned: 1,
  page_taken: 1,
  page_available: 1,
  itemActive: "",
  itemActive2: "",
  searched: "",
  filters: {
    position: "W/R/T/Q",
    team: "All",
    draftClass: "All",
  },
  column2: "Owned",
  column3: "KTC SF",
  column4: "ADP SF D",
  column5: "Age",
  sortBy: {
    column: 2,
    asc: false,
  },
  tabSecondary: "Owned",
};

const PlayersPrimaryReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_PLAYERS":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default PlayersPrimaryReducer;
