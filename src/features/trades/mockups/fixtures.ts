import type { ManagerLeague } from "@/shared/manager";

import type { TradeOption } from "../filters";
import type { KtcValue, PlayerSummary, Trade, TradeManager } from "../types";

/**
 * Stand-in data for the layout mockups, shaped as the real payloads.
 *
 * The mockups render the *real* `TradeCard` and the real `OptionPicker`, so what
 * they need is a payload rather than a picture of one — a card laid out against
 * invented markup would be a mockup of markup that doesn't ship. Everything here
 * is the shape `/api/trades` sends, with the counts a busy season's facets
 * actually come back with, so the option lists sit at the width they will.
 */

const DAY = 86_400_000;
/**
 * A fixed instant rather than `Date.now()`, so a screenshot taken twice is the
 * same screenshot — the card prints the clock time, which is the one thing on it
 * that would otherwise move between runs.
 */
const NOW = Date.parse("2026-08-03T12:51:00Z");

export const MOCK_LEAGUES: ManagerLeague[] = [
  league("1", "Win Two to Get your Due", ["QB", "RB", "RB", "WR", "WR", "TE", "SUPER_FLEX"]),
  league("2", "Whose ZONE is this?", ["QB", "RB", "RB", "WR", "WR", "TE", "SUPER_FLEX"]),
  league("3", "Dynasty SZN Live 3", ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"]),
];

function league(id: string, name: string, slots: string[]): ManagerLeague {
  return {
    league_id: id,
    name,
    season: "2026",
    status: "pre_draft",
    total_rosters: 12,
    avatar: null,
    record: null,
    settings: { type: 2 },
    roster_positions: [...slots, "BN", "BN", "BN", "BN"],
    scoring_settings: { rec: 1 },
  };
}

export const MOCK_MANAGERS: Record<string, TradeManager> = {
  u1: { user_id: "u1", display_name: "DarksideEmperors", avatar_url: null },
  u2: { user_id: "u2", display_name: "dknights", avatar_url: null },
  u3: { user_id: "u3", display_name: "TuckYaChainz", avatar_url: null },
  u4: { user_id: "u4", display_name: "OdderJobADR", avatar_url: null },
  u5: { user_id: "u5", display_name: "FFGuru42", avatar_url: null },
  u6: { user_id: "u6", display_name: "relentless88", avatar_url: null },
};

export const MOCK_PLAYERS: Record<string, PlayerSummary> = {
  p1: player("p1", "Rashee Rice", "WR", "KC"),
  p2: player("p2", "DK Metcalf", "WR", "PIT"),
  p3: player("p3", "Deebo Samuel", "WR", "SF"),
  p4: player("p4", "Kenny Gainwell", "RB", "TB"),
  p5: player("p5", "Oronde Gadsden", "TE", "LAC"),
  p6: player("p6", "Zach Charbonnet", "RB", "SEA"),
  p7: player("p7", "Marvin Harrison", "WR", "ARI"),
  p8: player("p8", "Kenyon Sadiq", "TE", "NYJ"),
  p9: player("p9", "Darius Slayton", "WR", "NYG"),
  p10: player("p10", "Theo Johnson", "TE", "NYG"),
  p11: player("p11", "Josh Downs", "WR", "IND"),
  p12: player("p12", "Michael Wilson", "WR", "ARI"),
};

function player(
  player_id: string,
  name: string,
  position: string,
  team: string,
): PlayerSummary {
  return { player_id, name, position, team };
}

/** Both boards per player, as the stream sends them. */
export const MOCK_KTC: Record<string, KtcValue> = {
  p1: { sf: 4951, oneqb: 4300 },
  p2: { sf: 2400, oneqb: 2900 },
  p3: { sf: 3100, oneqb: 3500 },
  p4: { sf: 1800, oneqb: 2050 },
  p5: { sf: 3784, oneqb: 3400 },
  p6: { sf: 4200, oneqb: 4600 },
  p7: { sf: 6100, oneqb: 6800 },
  p8: { sf: 1858, oneqb: 1700 },
  p9: { sf: 1200, oneqb: 1400 },
  p10: { sf: 2444, oneqb: 2600 },
  p11: { sf: 2100, oneqb: 2400 },
  p12: { sf: 1500, oneqb: 1700 },
};

export const MOCK_TRADES: Trade[] = [
  {
    transaction_id: "t1",
    league_id: "1",
    week: null,
    completed_at: NOW,
    sides: [
      { roster_id: 1, user_id: "u1", players: ["p1"], picks: [], faab: 0 },
      {
        roster_id: 2,
        user_id: "u2",
        players: ["p2"],
        picks: [{ season: "2026", round: 1, roster_id: 1 }],
        faab: 0,
      },
    ],
  },
  {
    transaction_id: "t2",
    league_id: "2",
    week: null,
    completed_at: NOW - 6.5 * 3_600_000,
    sides: [
      {
        roster_id: 3,
        user_id: "u3",
        players: ["p3", "p4", "p5"],
        picks: [],
        faab: 0,
      },
      {
        roster_id: 4,
        user_id: "u4",
        players: ["p6", "p7", "p8"],
        picks: [],
        faab: 0,
      },
    ],
  },
  {
    transaction_id: "t3",
    league_id: "3",
    week: null,
    completed_at: NOW - 6.6 * 3_600_000,
    sides: [
      {
        roster_id: 5,
        user_id: "u5",
        players: ["p9", "p10"],
        picks: [{ season: "2027", round: 4, roster_id: 6 }],
        faab: 0,
      },
      {
        roster_id: 6,
        user_id: "u6",
        players: ["p11", "p12"],
        picks: [],
        faab: 25,
      },
    ],
  },
  {
    transaction_id: "t4",
    league_id: "1",
    week: null,
    completed_at: NOW - DAY,
    sides: [
      {
        roster_id: 7,
        user_id: "u6",
        players: [],
        picks: [
          { season: "2026", round: 1, roster_id: 2 },
          { season: "2026", round: 2, roster_id: 7 },
        ],
        faab: 0,
      },
      { roster_id: 8, user_id: "u3", players: ["p7"], picks: [], faab: 0 },
    ],
  },
];

/** The facet menus, at the counts a crawled season returns. */
export const MOCK_MANAGER_OPTIONS: TradeOption[] = [
  { value: "m1", label: "Buscemi25", count: 215 },
  { value: "m2", label: "andyrrt1", count: 151 },
  { value: "m3", label: "MozAlgorithm", count: 146 },
  { value: "m4", label: "BearDown2653", count: 140 },
  { value: "m5", label: "davis1983", count: 139 },
  { value: "m6", label: "relentless88", count: 128 },
  { value: "m7", label: "TuckYaChainz", count: 121 },
  { value: "m8", label: "OdderJobADR", count: 118 },
];

export const MOCK_PLAYER_OPTIONS: TradeOption[] = [
  { value: "pl1", label: "Brian Thomas", note: "WR · JAX", count: 877 },
  { value: "pl2", label: "Luther Burden", note: "WR · CHI", count: 799 },
  { value: "pl3", label: "Bhayshul Tuten", note: "RB · JAX", count: 798 },
  { value: "pl4", label: "A.J. Brown", note: "WR · NE", count: 776 },
  { value: "pl5", label: "Bucky Irving", note: "RB · TB", count: 765 },
  { value: "pl6", label: "Marvin Harrison", note: "WR · ARI", count: 702 },
  { value: "pl7", label: "Rashee Rice", note: "WR · KC", count: 688 },
  { value: "pl8", label: "Zach Charbonnet", note: "RB · SEA", count: 641 },
];

export const MOCK_PICK_OPTIONS: TradeOption[] = [
  { value: "2026-1", label: "2026 1st", count: 3104 },
  { value: "2026-2", label: "2026 2nd", count: 2455 },
  { value: "2027-1", label: "2027 1st", count: 1880 },
  { value: "2026-3", label: "2026 3rd", count: 1341 },
  { value: "2027-2", label: "2027 2nd", count: 1102 },
  { value: "2028-1", label: "2028 1st", count: 640 },
];

/** The board's own size, and what the mocked selection narrows it to. */
export const MOCK_SCOPE_TOTAL = 51_204;
export const MOCK_TOTAL = 4_318;
