const initialState = {
  column2: "D Total",
  column3: "R Total",
  column3b: "D ADP",
  sortBy: {
    column: 2,
    asc: false,
  },
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
