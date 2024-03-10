const position_map = {
  QB: ["QB"],
  RB: ["RB", "FB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "FB", "WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "FB", "WR", "TE"],
  WRRB_FLEX: ["RB", "FB", "WR"],
  REC_FLEX: ["WR", "TE"],
};
const position_abbrev = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  SUPER_FLEX: "SF",
  FLEX: "WRT",
  WRRB_FLEX: "W R",
  WRRB_WRT: "W R",
  REC_FLEX: "W T",
};

export const getOptimalLineupADP = ({
  roster,
  roster_positions,
  adpLm,
  allplayers,
  type,
}) => {
  const optimal_lineup = [];

  let players = (roster?.players || []).map((player_id) => {
    return {
      player_id: player_id,
      adp: adpLm?.[type]?.[player_id]?.adp || 999,
    };
  });

  const starting_slots = roster_positions
    .filter((x) => Object.keys(position_map).includes(x))
    .map((slot, index) => {
      return {
        slot: slot,
        index: index,
      };
    });

  starting_slots
    .sort(
      (a, b) =>
        (position_map[a.slot]?.length || 999) -
        (position_map[b.slot]?.length || 999)
    )
    .map((s) => {
      const slot_options = players
        .filter((x) =>
          position_map[s.slot].includes(
            allplayers[x.player_id]?.position ||
              position_map[s.slot].some((p) =>
                allplayers[x.player_id]?.fantasy_positions?.includes(p)
              )
          )
        )
        .sort((a, b) => a.adp - b.adp);

      const optimal_player = slot_options[0]?.player_id;

      players = players.filter((x) => x.player_id !== optimal_player);

      optimal_lineup.push({
        slot_raw: s.slot,
        slot: position_abbrev[s.slot],
        player_id: optimal_player || 0,
      });
    });

  return optimal_lineup;
};
