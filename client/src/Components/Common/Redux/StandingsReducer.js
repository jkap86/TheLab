const initialState = {
  column2: "Total D",
  column3: "Total R",
  column3b: "ADP D",
  syncing: false,
};

const StandingsReducer = (state = initialState, action) => {
  switch (action.type) {
    case "SET_STATE_STANDINGS":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default StandingsReducer;
