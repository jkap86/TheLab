import { setStateUser } from "../../Common/Redux/actions";

export const setStateLeaguemates = (state_obj, tab) => ({
  type: `SET_STATE_LEAGUEMATES`,
  payload: state_obj,
});

export const setStateLeaguemateLeagues = (state_obj, tab) => ({
  type: `SET_STATE_LEAGUEMATE_LEAGUES`,
  payload: state_obj,
});

export const fetchLeaguemates = (leagues) => async (dispatch) => {
  const lm_dict = {};

  leagues.forEach((league) => {
    league.rosters
      ?.filter(
        (roster) =>
          parseInt(roster.user_id) > 0 &&
          roster.user_id !== league.userRoster.user_id &&
          league.userRoster?.players?.length > 0
      )
      ?.forEach((roster) => {
        let lm_leagues = lm_dict[roster.user_id] || {
          user_id: roster.user_id,
          username: roster.username,
          avatar: roster.avatar,
          leagues: [],
        };

        lm_leagues.leagues.push({
          ...league,
          lmRoster: roster,
        });

        lm_dict[roster.user_id] = lm_leagues;
      });
  });

  const leaguemates = Object.values(lm_dict);
  console.log({ leaguemates });

  dispatch(setStateUser({ leaguemates: leaguemates }));
};
