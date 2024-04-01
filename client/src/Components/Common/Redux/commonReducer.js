const initialState = {
  state: false,
  allplayers: false,
  schedule: false,
  projections: false,
  ktc: false,
  adpAll: false,
  recent_users: false,
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
