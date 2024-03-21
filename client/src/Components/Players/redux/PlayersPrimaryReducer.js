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
  sortBy: "Owned",
  column2: "ADP SF D",
  column3: "Auction Budget% D",
  column4: "Owned",
  column5: "Owned %",
  sortBy: {
    column: 2,
    asc: true,
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
