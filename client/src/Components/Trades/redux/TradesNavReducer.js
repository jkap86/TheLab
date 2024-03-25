const initialState = {
  tabPrimary: "Leaguemate League Trades",
  tabSecondary: "Rosters",
  valueType: "Auction %",
};

const TradesNavReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_TRADESNAV":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default TradesNavReducer;
