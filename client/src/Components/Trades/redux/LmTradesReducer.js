const initialState = {
  isLoading: false,
  count: "",
  trades: false,
  itemActive: "",
  page: 1,
  searched_player: "",
  searched_manager: "",
  searches: [],
  error: null,
};

const LmTradesReducer = (state = initialState, action) => {
  let existing_trades, new_trades, updated_search;
  switch (action.type) {
    case "FETCH_LMTRADES_START":
      return { ...state, isLoading: true, error: null };
    case "FETCH_LMTRADES_SUCCESS":
      console.log("TRADES REDUCER");

      return {
        ...state,
        count: action.payload.count,
        trades: [
          ...(state.trades || []),
          ...action.payload.trades.filter(
            (t1) =>
              !(state.trades || []).find(
                (t2) => t1.transaction_id === t2.transaction_id
              )
          ),
        ],
      };
    case "FETCH_FILTERED_LMTRADES_SUCCESS":
      existing_trades =
        state.searches.find(
          (s) =>
            s.player === action.payload.player &&
            s.manager === action.payload.manager
        )?.trades || [];

      new_trades = action.payload.trades.filter(
        (new_trade) =>
          !existing_trades.find(
            (old_trade) => new_trade.transaction_id === old_trade.transaction_id
          )
      );

      updated_search = {
        player: action.payload.player,
        manager: action.payload.manager,
        count: action.payload.count,
        trades: [...existing_trades, ...new_trades],
      };

      console.log({ updated_search });

      return {
        ...state,
        isLoading: false,

        searches: [
          ...state.searches.filter(
            (s) =>
              !(
                s.player === action.payload.player &&
                s.manager === action.payload.manager
              )
          ),
          updated_search,
        ],
      };
    case "FETCH_LMTRADES_FAILURE":
      return { ...state, isLoading: false, error: action.payload };
    case "SET_STATE_LMTRADES":
      return {
        ...state,
        ...action.payload,
      };
    case "RESET_STATE":
      return {
        ...initialState,
      };
    default:
      return state;
  }
};

export default LmTradesReducer;
