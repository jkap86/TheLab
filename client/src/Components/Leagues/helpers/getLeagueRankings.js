import {
  getRosterPicksValue,
  getPlayersValue,
} from "../../Common/Helpers/rosterValues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";

export const getRookiePickKTCValue = ({ pick, ktc, allplayers, state }) => {
  const pick_ovr =
    (pick.round - 1) * 12 +
    ((pick.season === state.season && pick.order) ||
      6 + (parseInt(pick.season) - parseInt(state.season)) * 3);

  const rookie_player_ids = Object.keys(ktc)
    .filter((player_id) => allplayers[player_id]?.years_exp === 0)
    .sort((a, b) => ktc[b].superflex - ktc[a].superflex);

  const pick_value = ktc[rookie_player_ids?.[pick_ovr - 1]]?.superflex || 0;

  return pick_value;
};

export const getLeagueRankings = ({
  league,
  adpLm,
  allplayers,
  ktc,
  state,
}) => {
  const standings_detail = league.rosters.map((roster) => {
    const dynasty_picks = getRosterPicksValue(
      roster.draft_picks,
      adpLm,
      league.season,
      "Dynasty"
    );

    const dynasty_optimal = getOptimalLineupADP({
      roster,
      roster_positions: league.roster_positions,
      adpLm,
      allplayers,
      type: "Dynasty",
    });

    const optimal_dynasty_player_ids = dynasty_optimal.map(
      (slot) => slot.player_id
    );

    const dynasty_starters = getPlayersValue(
      optimal_dynasty_player_ids,
      "Dynasty",
      adpLm
    );

    const dynasty_bench = getPlayersValue(
      roster.players?.filter(
        (player_id) => !optimal_dynasty_player_ids.includes(player_id)
      ),
      "Dynasty",
      adpLm
    );

    const redraft_optimal = getOptimalLineupADP({
      roster,
      roster_positions: league.roster_positions,
      adpLm,
      allplayers,
      type: "Redraft",
    });

    const optimal_redraft_player_ids = redraft_optimal.map(
      (slot) => slot.player_id
    );

    const redraft_starters = getPlayersValue(
      optimal_redraft_player_ids,
      "Redraft",
      adpLm
    );

    const redraft_bench = getPlayersValue(
      roster.players?.filter(
        (player_id) => !optimal_redraft_player_ids.includes(player_id)
      ),
      "Redraft",
      adpLm
    );

    const redraft_picks = getRosterPicksValue(
      roster.draft_picks.filter(
        (pick) => pick.season === parseInt(league.season)
      ),
      adpLm,
      league.season,
      "Redraft"
    );

    const dynasty_starters_ktc = optimal_dynasty_player_ids.reduce(
      (acc, cur) => acc + (ktc[cur]?.superflex || 0),
      0
    );

    const dynasty_bench_ktc = (roster.players || [])
      .filter((player_id) => !optimal_dynasty_player_ids.includes(player_id))
      .reduce((acc, cur) => acc + (ktc[cur]?.superflex || 0), 0);

    const dynasty_picks_ktc = (roster.draft_picks || []).reduce(
      (acc, cur) =>
        acc + getRookiePickKTCValue({ pick: cur, ktc, allplayers, state }),
      0
    );

    return {
      ...roster,
      dynasty_picks,
      dynasty_starters,
      dynasty_bench,
      dynasty_players: dynasty_starters + dynasty_bench,
      dynasty_total: dynasty_starters + dynasty_bench + dynasty_picks,
      redraft_starters,
      redraft_bench,
      redraft_picks,
      redraft_players: redraft_starters + redraft_bench,
      redraft_total: redraft_starters + redraft_bench + redraft_picks,
      dynasty_optimal,
      redraft_optimal,
      starters_optimal_dynasty: optimal_dynasty_player_ids,
      starters_optimal_redraft: optimal_redraft_player_ids,
      dynasty_starters_ktc,
      dynasty_bench_ktc,
      dynasty_picks_ktc,
    };
  });

  return standings_detail;
};
