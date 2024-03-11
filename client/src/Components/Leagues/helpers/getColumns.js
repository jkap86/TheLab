import { getTrendColorRank } from "../../Common/Helpers/getTrendColor";

export const getColumnValue = (
  league,
  header,
  isLoadingAdp,
  standings_detail
) => {
  let text;
  if ((header.includes("Rank") || header.includes("Value")) && isLoadingAdp) {
    text = <i className="fa-solid fa-spinner fa-spin-pulse"></i>;
  } else {
    switch (header) {
      case "Picks Rank":
        const rank_dynasty_picks =
          standings_detail
            .sort((a, b) => b.dynasty_picks - a.dynasty_picks)
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = (
          <span
            className="stat"
            style={getTrendColorRank(
              league.rosters.length - rank_dynasty_picks + 1,
              1,
              league.rosters.length
            )}
          >
            {rank_dynasty_picks}
          </span>
        );
        break;
      case "Players Rank D":
        const rank_dynasty_players =
          standings_detail
            .sort(
              (a, b) =>
                b.dynasty_starters +
                b.dynasty_bench -
                (a.dynasty_starters + b.dynasty_bench)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = (
          <span
            className="stat"
            style={getTrendColorRank(
              league.rosters.length - rank_dynasty_players,
              1,
              league.rosters.length,
              Array.from(Array(league.rosters.length))
                .keys()
                .map((key) => key + 1)
                .reduce((acc, cur) => acc + cur, 0) / league.rosters.length
            )}
          >
            {rank_dynasty_players}
          </span>
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

        text = (
          <span
            className="stat"
            style={getTrendColorRank(
              league.rosters.length - rank_dynasty,
              1,
              league.rosters.length
            )}
          >
            {rank_dynasty}
          </span>
        );
        break;
      case "Rank R":
        const rank_redraft =
          standings_detail
            .sort(
              (a, b) =>
                b.redraft_starters +
                b.redraft_bench -
                (a.redraft_starters + a.redraft_bench)
            )
            .findIndex((obj) => obj.roster_id === league.userRoster.roster_id) +
          1;

        text = (
          <span
            className="stat"
            style={getTrendColorRank(
              league.rosters.length - rank_redraft,
              1,
              league.rosters.length
            )}
          >
            {rank_redraft}
          </span>
        );

        break;
      default:
        text = "-";
        break;
    }
  }

  return {
    text: text,
    colSpan: 3,
  };
};
