const initialState = {
  user_id: false,
  username: false,
  avatar: null,
  leagues: false,
  leaguemates: false,
  leaguemate_ids: false,
  userPlayerShares: false,
  isLoadingUserPS: false,
  lmplayershares: false,
  matchups: false,
  isLoadingUser: false,
  errorUser: false,
  isLoadingLeagues: false,
  errorLeagues: false,
  isLoadingPS: false,
  errorPS: false,
  isLoadingMatchups: false,
  errorMatchups: false,
  syncing: false,
  errorSyncing: false,
  type1: "All",
  type2: "All",
  lmLeagueIds: false,
  isLoadingLmLeagueIds: false,
  errorLmLeagueIds: false,
  adpLm: false,
  isLoadingAdp: false,
  errorAdp: false,
};

const userReducer = (state = initialState, action) => {
  switch (action.type) {
    case "FETCH_USER_START":
      return {
        ...initialState,
        isLoadingUser: true,
      };
    case "FETCH_USER_SUCCESS":
      return {
        ...state,
        user_id: action.payload.user_id,
        username: action.payload.username,
        avatar: action.payload.avatar,
        isLoadingUser: false,
      };
    case "FETCH_USER_FAILURE":
      return {
        ...state,
        isLoadingUser: false,
        errorUser: action.payload,
      };
    case "FETCH_LEAGUES_START":
      return {
        ...state,
        isLoadingLeagues: true,
        errorLeagues: null,
      };
    case "FETCH_LEAGUES_SUCCESS":
      const leaguemate_ids = [];

      const leagues = action.payload.filter((l) => l.userRoster);

      leagues.forEach((league) => {
        league.rosters
          .filter((roster) => parseInt(roster.user_id))
          .forEach((roster) => {
            leaguemate_ids.push(roster.user_id);
          });
      });

      return {
        ...state,
        isLoadingLeagues: false,
        leagues: leagues,
        leaguemate_ids: Array.from(new Set(leaguemate_ids)),
      };

    case "FETCH_LEAGUES_FAILURE":
      return {
        ...state,
        isLoadingLeagues: false,
        errorLeagues: action.payload,
      };
    case "FETCH_MATCHUPS_START":
      return {
        ...state,
        isLoadingMatchups: true,
        errorMatchups: null,
      };
    case "FETCH_MATCHUPS_SUCCESS":
      const updated_leagues = [];

      state.leagues.forEach((league) => {
        const updates_league = action.payload.find(
          (l) => l.league_id === league.league_id
        );

        updated_leagues.push({
          ...league,
          ...updates_league,
          userRoster: updates_league
            ? updates_league.rosters?.find(
                (r) =>
                  r.user_id === state.user_id ||
                  r.co_owners?.find((co) => co?.user_id === state.user_id)
              )
            : league.userRoster,
        });
      });

      return {
        ...state,
        isLoadingMatchups: false,
        leagues: updated_leagues,
        matchups: true,
      };
    case "FETCH_MATCHUPS_FAILURE":
      return {
        ...state,
        isLoadingMatchups: false,
        errorMatchups: action.payload,
      };
    case "SYNC_LEAGUES_START":
      return { ...state, errorSyncing: null };
    case "SYNC_LEAGUES_SUCCESS":
      const synced_leagues = state.leagues.map((l) => {
        if (l.league_id === action.payload.league.league_id) {
          return {
            ...l,
            ...action.payload.league,
          };
        }
        return l;
      });

      return {
        ...state,
        leagues: synced_leagues,
      };
    case "SYNC_LEAGUES_FAILURE":
      return { ...state, syncing: false, errorSyncing: action.payload };
    case "SET_STATE_USER":
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

export default userReducer;
