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
  allplayers,
  ktc
) => {
  const leagues_count =
    leagues_owned.length + leagues_available.length + leagues_taken.length;

  const max_adp_r = Math.max(
    ...Object.keys(adpLm?.["Redraft"] || {}).map(
      (player_id) => adpLm?.["Redraft"]?.[player_id]?.adp
    )
  );

  const max_adp_d = Math.max(
    ...Object.keys(adpLm?.["Dynasty"] || {}).map(
      (player_id) => adpLm?.["Dynasty"]?.[player_id]?.adp
    )
  );

  const adp_deltas = Array.from(
    new Set([
      ...Object.keys(adpLm?.["Dynasty"] || {}),
      Object.keys(adpLm?.["Redraft"] || {}),
    ])
  ).map(
    (player_id) =>
      (adpLm?.["Dynasty"]?.[player_id]?.adp || max_adp_d) -
      (adpLm?.["Redraft"]?.[player_id]?.adp || max_adp_r)
  );

  const adp_r = adpLm?.["Redraft"]?.[player_id]?.adp;

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

  let text, trendColor, sort;

  if (
    ((header.includes("ADP") || header.includes("Auction")) && !adpLm) ||
    (header.includes("KTC") && !ktc)
  ) {
    text = <i className="fa-solid fa-spinner fa-spin-pulse"></i>;
    trendColor = {};
    sort = leagues_owned.length;
  } else {
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
        text = (adp_r && getAdpFormatted(adp_r)) || "-";

        sort = adp_r || 999;

        trendColor = getTrendColorRank(200 - adp_r, 1, 200);

        break;
      case "ADP SF D":
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

        trendColor = getTrendColorValue(
          adp_auction,
          Object.keys(adpLm?.["Dynasty_auction"] || {}).map(
            (player_id) => adpLm["Dynasty_auction"][player_id].adp
          )
        );

        break;
      case "Age":
        const min_age = 20;
        const max_age = allplayers?.[player_id]?.position === "QB" ? 35 : 30;

        text = allplayers?.[player_id]?.age || "-";
        trendColor = getTrendColorRank(
          max_age - allplayers?.[player_id]?.age + min_age,
          min_age,
          max_age
        );
        sort = allplayers?.[player_id]?.age || 0;

        break;
      case "ADP SF D-R":
        const delta = (adp_r || max_adp_r) - (adp_d || max_adp_d);
        text = delta.toFixed(0);
        sort = delta;
        trendColor = getTrendColorRank(delta, -100, 100);
        break;
      case "KTC SF":
        const value = ktc[player_id]?.superflex || 0;
        text = value;
        sort = value;
        trendColor = getTrendColorRank(value, 1, 1000);
        break;
      default:
        text = "-";
        trendColor = {};
        break;
    }
  }
  return { text, trendColor, sort };
};
