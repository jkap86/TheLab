import { setStateUser } from "../../Common/Redux/actions";

export const setStatePlayers = (state_obj, tab) => ({
  type: `SET_STATE_PLAYERS`,
  payload: state_obj,
});

export const setStateLeaguesOwned = (state_obj, tab) => ({
  type: `SET_STATE_LEAGUES_OWNED`,
  payload: state_obj,
});

export const getPlayerShares = (leagues) => async (dispatch) => {
  const players_dict = {};

  leagues.forEach((league) => {
    const userRoster = league.userRoster;

    league.rosters?.forEach((roster) => {
      roster.players?.forEach((player_id) => {
        let player_leagues = players_dict[player_id] || {
          id: player_id,
          leagues_owned: [],
          leagues_taken: [],
        };

        if (roster.user_id === userRoster?.user_id) {
          player_leagues.leagues_owned.push(league);
        } else {
          player_leagues.leagues_taken.push({
            ...league,
            lmRoster: roster,
          });
        }

        players_dict[player_id] = player_leagues;
      });

      roster.draft_picks?.forEach((pick) => {
        const pick_text = `${pick.season}_${pick.round}_${
          parseInt(pick.season) === parseInt(league.season)
            ? pick.order?.toLocaleString("en-US", { minimumIntegerDigits: 2 })
            : undefined
        }`;

        let pick_leagues = players_dict[pick_text] || {
          id: pick_text,
          leagues_owned: [],
          leagues_taken: [],
        };

        if (roster.user_id === userRoster?.user_id) {
          pick_leagues.leagues_owned.push({
            ...league,
          });
        } else {
          pick_leagues.leagues_taken.push({
            ...league,
            lmRoster: roster,
          });
        }

        players_dict[pick_text] = pick_leagues;
      });
    });
  });

  const playerShares = Object.values(players_dict).map((player) => {
    return {
      ...player,
      leagues_available: player.id.includes("_")
        ? []
        : leagues.filter(
            (l) => !l.rosters?.find((r) => r.players?.includes(player.id))
          ),
    };
  });

  dispatch(setStateUser({ userPlayerShares: playerShares }));
};
