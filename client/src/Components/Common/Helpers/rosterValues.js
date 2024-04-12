export const getPickOvr = ({ pick, season }) => {
  const pick_ovr =
    (pick.round - 1) * 12 +
    ((pick.season === season && pick.order) ||
      6 + (parseInt(pick.season) - parseInt(season)) * 3);

  return pick_ovr;
};

export const getRosterPicksValue = (draft_picks, adp, league_season) => {
  const picks_value = (draft_picks || []).reduce(
    (acc, cur) =>
      acc +
      (adp?.[`Dynasty_auction`]?.[
        "R" + getPickOvr({ pick: cur, season: league_season })
      ]?.adp || 0),
    0
  );
  return picks_value;
};

export const getPlayersValue = (player_ids, type, adp) => {
  const players_value = (player_ids || []).reduce(
    (acc, cur) => acc + (adp?.[`${type}_auction`]?.[cur]?.adp || 0),
    0
  );

  return players_value;
};
