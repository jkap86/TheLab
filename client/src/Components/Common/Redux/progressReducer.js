const initialState = {
    progress: 0
}

const progressReducer = (state = initialState, action) => {
    switch (action.type) {
        case 'SET_STATE_PROGRESS':
            return {
                ...state,
                ...action.payload
            };
        case 'RESET_STATE':
            return {
                ...initialState
            };
        default:
            return state;
    }
}

export default progressReducer;