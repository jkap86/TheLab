const initialState = {
  column3: "Lm Record",
  column4: "Lm FP",
  column5: "Record",
  column6: "FP",
  itemActive: "",
  page: 1,
  searched: "",
  secondaryContent: "Leagues",
  itemActive_leagues: "",
  page_leagues: 1,
  itemActive_players: "",
  page_players_c: 1,
  page_players_a: 1,
  searched_players: "",
  sortBy: {
    column: 2,
    asc: false,
  },
};

const LeaguematesPrimaryReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_LEAGUEMATES":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default LeaguematesPrimaryReducer;
