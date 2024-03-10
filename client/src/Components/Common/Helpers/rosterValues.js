export const getRosterPicksValue = (draft_picks, type, adp, league_season) => {
  const picks_value = (draft_picks || []).reduce(
    (acc, cur) =>
      acc +
      (adp?.[`${type}_auction`]?.[
        "R" +
          +(
            (cur.round - 1) * 12 +
            (parseInt(cur.season === parseInt(league_season) && cur.order) || 7)
          )
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
