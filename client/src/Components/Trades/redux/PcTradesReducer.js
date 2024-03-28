const initialState = {
  isLoading: false,
  searches: [],
  itemActive: "",
  page: 1,
  pricecheck_player: "",
  pricecheck_player2: "",
  error: null,
};

const PcTradesReducer = (state = initialState, action) => {
  let existing_trades, new_trades, updated_search;
  switch (action.type) {
    case "FETCH_PCTRADES_START":
      return { ...state, isLoading: true, error: null };
    case "FETCH_PCTRADES_SUCCESS":
      console.log({ type: "FETCH_PCTRADES_SUCCESS" });
      existing_trades =
        state.searches.find(
          (s) =>
            s.pricecheck_player === action.payload.pricecheck_player &&
            s.pricecheck_player2 === action.payload.pricecheck_player2
        )?.trades || [];

      new_trades = action.payload.trades.filter(
        (new_trade) =>
          !existing_trades.find(
            (old_trade) => new_trade.transaction_id === old_trade.transaction_id
          )
      );

      updated_search = {
        pricecheck_player: action.payload.pricecheck_player,
        pricecheck_player2: action.payload.pricecheck_player2,
        count: action.payload.count,
        trades: [...existing_trades, ...new_trades],
      };

      return {
        ...state,
        isLoading: false,
        searches: [
          ...state.searches.filter(
            (s) =>
              !(
                s.pricecheck_player === action.payload.pricecheck_player &&
                s.pricecheck_player2 === action.payload.pricecheck_player2
              )
          ),
          updated_search,
        ],
      };
    case "FETCH_PCTRADES_FAILURE":
      return { ...state, isLoading: false, error: action.payload };
    case "SET_STATE_PCTRADES":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default PcTradesReducer;
