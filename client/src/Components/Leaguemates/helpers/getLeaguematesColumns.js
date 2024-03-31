import { getTrendColorRank } from "../../Common/Helpers/getTrendColor";

export const getLeaguematesColumns = ({
  column,
  lm_leagues_count,
  lm_leagues,
}) => {
  const lm_wins = lm_leagues?.reduce(
    (acc, cur) => acc + cur.lmRoster.settings?.wins,
    0
  );
  const lm_losses = lm_leagues?.reduce(
    (acc, cur) => acc + cur.lmRoster.settings?.losses,
    0
  );
  const lm_ties = lm_leagues?.reduce(
    (acc, cur) => acc + cur.lmRoster.settings.ties,
    0
  );

  const lm_games = lm_wins + lm_losses + lm_ties;

  const lm_winpct = lm_wins + lm_losses + lm_ties > 0 && lm_wins / lm_games;

  const lm_fpts = lm_leagues?.reduce(
    (acc, cur) =>
      acc +
      parseFloat(
        cur.lmRoster.settings?.fpts + "." + cur.lmRoster.settings?.fpts_decimal
      ),
    0
  );

  const user_wins = lm_leagues?.reduce(
    (acc, cur) => acc + cur.userRoster.settings?.wins,
    0
  );
  const user_losses = lm_leagues?.reduce(
    (acc, cur) => acc + cur.userRoster.settings?.losses,
    0
  );
  const user_ties = lm_leagues?.reduce(
    (acc, cur) => acc + cur.userRoster.settings?.ties,
    0
  );

  const user_games = user_wins + user_losses + user_ties;

  const user_winpct =
    user_wins + user_losses + user_ties > 0 && user_wins / user_games;

  const user_fpts = lm_leagues?.reduce(
    (acc, cur) =>
      acc +
      parseFloat(
        cur.userRoster.settings?.fpts +
          "." +
          cur.userRoster.settings?.fpts_decimal
      ),
    0
  );

  let text, sort, trendColor;

  switch (column) {
    case "Record":
      text = `${user_wins}-${user_losses}${
        user_ties > 0 ? `-${user_ties}` : ""
      }`;
      sort = user_winpct;
      trendColor = user_games > 0 ? getTrendColorRank(user_winpct, 0, 1) : {};
      break;
    case "FP":
      text = user_fpts;
      sort = user_fpts;
      trendColor = getTrendColorRank(
        user_fpts,
        (user_fpts + lm_fpts) * 0.25,
        (user_fpts + lm_fpts) * 0.75
      );
      break;
    case "Lm Record":
      text = `${lm_wins}-${lm_losses}${lm_ties > 0 ? `-${lm_ties}` : ""}`;
      sort = lm_winpct;
      trendColor = lm_games > 0 ? getTrendColorRank(lm_winpct, 0, 1) : {};
      break;
    case "Lm FP":
      text = lm_fpts;
      sort = lm_fpts;
      trendColor = getTrendColorRank(
        lm_fpts,
        (user_fpts + lm_fpts) * 0.25,
        (user_fpts + lm_fpts) * 0.75
      );
      break;
    default:
      text = "-";
      sort = lm_leagues_count;
      trendColor = {};
      break;
  }

  return { text, trendColor, sort };
};
