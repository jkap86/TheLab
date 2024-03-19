import { getAdpFormatted } from "../../Common/Helpers/getAdpFormatted";
import {
  getTrendColorRank,
  getTrendColorValue,
} from "../../Common/Helpers/getTrendColor";

export const getPlayersColumn = (
  header,
  leagues_owned,
  leagues_taken,
  leagues_available,
  record,
  winpct,
  record_lm,
  winpct_lm,
  adpLm,
  player_id,
  sorted
) => {
  let text, trendColor, sort;

  const leagues_count =
    leagues_owned.length + leagues_available.length + leagues_taken.length;
  switch (header) {
    case "Owned":
      text = leagues_owned?.length;

      sort = leagues_owned?.length;

      trendColor = getTrendColorRank(
        leagues_owned.length,
        -(leagues_count / 2),
        leagues_count / 2
      );
      break;
    case "Owned %":
      text = ((leagues_owned?.length / leagues_count) * 100).toFixed(0) + "%";

      sort = (leagues_owned?.length / leagues_count) * 100;

      trendColor = getTrendColorRank(
        leagues_owned.length,
        -(leagues_count / 2),
        leagues_count / 2
      );
      break;
    case "W/L":
      text = record;

      sort = winpct;

      trendColor = getTrendColorRank(winpct, 0, 1);

      break;
    case "W %":
      text = winpct;

      sort = winpct;

      trendColor = getTrendColorRank(winpct, 0, 1);

      break;
    case "LM W/L":
      text = record_lm;

      sort = winpct_lm;

      trendColor = getTrendColorRank(winpct_lm, 0, 1);

      break;
    case "LM W %":
      text = winpct_lm;

      sort = winpct_lm;

      trendColor = getTrendColorRank(winpct_lm, 0, 1);

      break;
    case "ADP SF R":
      const adp_r = adpLm?.["Redraft"]?.[player_id]?.adp;

      text = (adp_r && getAdpFormatted(adp_r)) || "-";

      sort = adp_r || 999;

      trendColor = getTrendColorRank(200 - adp_r, 1, 200);

      break;
    case "ADP SF D":
      let adp_d;

      if (
        player_id.includes("_") &&
        parseInt(player_id.split("_")[1]) &&
        parseInt(player_id.split("_")[2])
      ) {
        const round = parseInt(player_id.split("_")[1]);
        const order = parseInt(player_id.split("_")[2]);

        const pick = "R" + ((round - 1) * 12 + order);

        adp_d = adpLm?.["Dynasty"]?.[pick]?.adp;
      } else {
        adp_d = adpLm?.["Dynasty"]?.[player_id]?.adp;
      }

      text = (adp_d && getAdpFormatted(adp_d)) || "-";

      sort = adp_d || 999;

      trendColor = getTrendColorRank(200 - adp_d, 1, 200);

      break;
    case "Auction Budget% D":
      let adp_auction;

      if (
        player_id.includes("_") &&
        parseInt(player_id.split("_")[1]) &&
        parseInt(player_id.split("_")[2])
      ) {
        const round = parseInt(player_id.split("_")[1]);
        const order = parseInt(player_id.split("_")[2]);

        const pick = "R" + ((round - 1) * 12 + order);

        adp_auction = adpLm?.["Dynasty_auction"]?.[pick]?.adp || 0;
      } else {
        adp_auction = adpLm?.["Dynasty_auction"]?.[player_id]?.adp || 0;
      }
      text = adp_auction?.toFixed(0) + "%";

      sort = adp_auction;

      trendColor = getTrendColorRank(
        adp_auction,
        1,
        Math.max(
          ...Object.keys(adpLm?.["Dynasty_auction"] || {}).map(
            (player_id) => adpLm["Dynasty_auction"][player_id].adp
          )
        )
      );

      break;

    default:
      text = "-";
      trendColor = {};
      break;
  }

  return { text, trendColor, sort };
};
