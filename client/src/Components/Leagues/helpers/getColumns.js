import { getTrendColorRank } from "../../Common/Helpers/getTrendColor";

export const getColumnValue = (
  league,
  header,
  isLoadingAdp,
  standings_detail
) => {
  let text;
  let getTrendColor;

  if ((header.includes("Rank") || header.includes("Value")) && isLoadingAdp) {
    text = <i className="fa-solid fa-spinner fa-spin-pulse"></i>;
    getTrendColor = {};
  } else {
    switch (header) {
      case "Rank D Picks":
        const rank_dynasty_picks =
          standings_detail
            .sort((a, b) => b.dynasty_picks - a.dynasty_picks)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_picks;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_picks + 1,
          1,
          league.rosters.length
        );
        break;
      case "Rank D Players":
        const rank_dynasty_players =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench -
                (a.dynasty_starters + a.dynasty_bench)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_players;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_players,
          1,
          league.rosters.length
        );

        break;
      case "Rank D Starters":
        const rank_dynasty_starters =
          standings_detail
            .sort((a, b) => b.dynasty_starters - a.dynasty_starters)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_starters;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_starters,
          1,
          league.rosters.length
        );

        break;
      case "Rank D Bench":
        const rank_dynasty_bench =
          standings_detail
            .sort((a, b) => b.dynasty_bench - a.dynasty_bench)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_bench;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_bench,
          1,
          league.rosters.length
        );

        break;
      case "Rank R Starters":
        const rank_redraft_starters =
          standings_detail
            .sort((a, b) => b.redraft_starters - a.redraft_starters)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_redraft_starters;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft_starters,
          1,
          league.rosters.length
        );

        break;
      case "Rank R Bench":
        const rank_redraft_bench =
          standings_detail
            .sort((a, b) => b.redraft_bench - a.redraft_bench)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_redraft_bench;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft_bench,
          1,
          league.rosters.length
        );

        break;
      case "Rank D":
        const rank_dynasty =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench +
                b.dynasty_picks -
                (a.dynasty_starters + a.dynasty_bench + a.dynasty_picks)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty,
          1,
          league.rosters.length
        );

        break;
      case "Lm Rank D":
        const lm_rank_dynasty =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench +
                b.dynasty_picks -
                (a.dynasty_starters + a.dynasty_bench + a.dynasty_picks)
            )
            .findIndex((obj) => obj.roster_id === league.lmRoster.roster_id) +
          1;

        text = lm_rank_dynasty;

        getTrendColor = getTrendColorRank(
          league.rosters.length - lm_rank_dynasty,
          1,
          league.rosters.length
        );

        break;
      case "Rank R Players":
        const rank_redraft_players =
          standings_detail
            .sort(
              (a, b) =>
                b.redraft_starters +
                b.redraft_bench -
                (a.redraft_starters + a.redraft_bench)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_redraft_players;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft_players,
          1,
          league.rosters.length
        );

        break;
      case "Rank R Picks":
        const rank_redraft_picks =
          standings_detail
            .sort((a, b) => b.redraft_picks - a.redraft_picks)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_redraft_picks;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft_picks,
          1,
          league.rosters.length
        );

        break;
      case "Rank R":
        const rank_redraft =
          standings_detail
            .sort(
              (a, b) =>
                b.redraft_starters +
                b.redraft_bench +
                b.redraft_picks -
                (a.redraft_starters + a.redraft_bench + a.redraft_picks)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_redraft;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft,
          1,
          league.rosters.length
        );

        break;
      case "Lm Rank R":
        const lm_rank_redraft =
          standings_detail
            .sort(
              (a, b) =>
                b.redraft_starters +
                b.redraft_bench -
                (a.redraft_starters + a.redraft_bench)
            )
            .findIndex((obj) => obj.roster_id === league.lmRoster.roster_id) +
          1;

        text = lm_rank_redraft;

        getTrendColor = getTrendColorRank(
          league.rosters.length - lm_rank_redraft,
          1,
          league.rosters.length
        );

        break;
      case "LM Picks Rank":
        const rank_dynasty_picks_lm =
          standings_detail
            .sort((a, b) => b.dynasty_picks - a.dynasty_picks)
            .findIndex((obj) => obj.roster_id === league.lmRoster.roster_id) +
          1;

        text = rank_dynasty_picks_lm;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_picks_lm + 1,
          1,
          league.rosters.length
        );
        break;
      case "LM Players Rank D":
        const rank_dynasty_players_lm =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench -
                (a.dynasty_starters + a.dynasty_bench)
            )
            .findIndex((obj) => obj.roster_id === league.lmRoster.roster_id) +
          1;

        text = rank_dynasty_players_lm;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_players_lm,
          1,
          league.rosters.length,
          Array.from(Array(league.rosters.length)).keys() ||
            [].map((key) => key + 1).reduce((acc, cur) => acc + cur, 0) /
              league.rosters.length
        );

        break;
      case "LM Rank D":
        const rank_dynasty_lm =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench +
                b.dynasty_picks -
                (a.dynasty_starters + a.dynasty_bench + a.dynasty_picks)
            )
            .findIndex((obj) => obj.roster_id === league.lmRoster?.roster_id) +
          1;

        text = rank_dynasty_lm;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_lm,
          1,
          league.rosters.length
        );

        break;
      case "LM Rank R":
        const rank_redraft_lm =
          standings_detail
            .sort(
              (a, b) =>
                b.redraft_starters +
                b.redraft_bench -
                (a.redraft_starters + a.redraft_bench)
            )
            .findIndex((obj) => obj.roster_id === league.lmRoster.roster_id) +
          1;

        text = rank_redraft_lm;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_redraft_lm,
          1,
          league.rosters.length
        );

        break;
      case "Rank D Starters KTC":
        const rank_dynasty_starters_ktc =
          standings_detail
            .sort((a, b) => b.dynasty_starters_ktc - a.dynasty_starters_ktc)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_starters_ktc;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_starters_ktc,
          1,
          league.rosters.length
        );

        break;
      case "Rank D Bench KTC":
        const rank_dynasty_bench_ktc =
          standings_detail
            .sort((a, b) => b.dynasty_bench_ktc - a.dynasty_bench_ktc)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_bench_ktc;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_bench_ktc,
          1,
          league.rosters.length
        );

        break;
      case "Rank D Picks KTC":
        const rank_dynasty_picks_ktc =
          standings_detail
            .sort((a, b) => b.dynasty_picks_ktc - a.dynasty_picks_ktc)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_picks_ktc;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_picks_ktc,
          1,
          league.rosters.length
        );

        break;
      case "Rank D KTC":
        const rank_dynasty_ktc =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters_ktc +
                b.dynasty_bench_ktc +
                b.dynasty_picks_ktc -
                (a.dynasty_starters_ktc +
                  a.dynasty_bench_ktc +
                  a.dynasty_picks_ktc)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = rank_dynasty_ktc;

        getTrendColor = getTrendColorRank(
          league.rosters.length - rank_dynasty_ktc,
          1,
          league.rosters.length
        );

        break;

      case "League ID":
        text = league.league_id;
        break;
      default:
        text = "-";
        break;
    }
  }

  return { text, getTrendColor };
};
