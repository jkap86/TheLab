const initialState = {
    username_searched: '',
    leagueId: '',
    tab: 'username',
    dropdownVisible: false,
    dropdownOptions: []

}

const homepageReducer = (state = initialState, action) => {
    switch (action.type) {
        case 'SET_STATE_HOME':
            return {
                ...state,
                ...action.payload
            };
        case 'RESET_STATE_HOME':
            return {
                ...initialState
            };
        default:
            return state;
    }
}

export default homepageReducer;