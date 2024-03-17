const initialState = {
  standingsType: "Dynasty",
  column2: "Starters",
  column3: "Total",
  valueType: "ADP",
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
