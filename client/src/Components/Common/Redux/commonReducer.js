const initialState = {
  state: false,
  allplayers: false,
  schedule: false,
  projections: false,
  values: false,
  adpAll: false,
  siteLinkIndex: 0,
};

const commonReducer = (state = initialState, action) => {
  switch (action.type) {
    case "FETCH_COMMON_START":
      return {
        ...state,
        errorUser: null,
      };
    case "FETCH_COMMON_SUCCESS":
      return {
        ...state,
        [action.payload.item]: action.payload.data,
      };
    case "SET_STATE_COMMON":
      return {
        ...state,
        ...action.payload,
      };
    default:
      return state;
  }
};

export default commonReducer;
