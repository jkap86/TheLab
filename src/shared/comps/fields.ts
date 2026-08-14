/**
 * The Comps field catalogue — every dimension a comparison can weigh, said once.
 *
 * Both ends of the wire read this module (the `projections/slots.ts` precedent):
 * the server parser validates `fields=` against it and resolves per-position
 * defaults from it, and the client's field editor renders it and writes its
 * spellings back onto the query string. It is pure and imports nothing, so the
 * client deep-imports it and the tests load it under Node's runner.
 *
 * **Every production `statKey` below is verified against stored stat lines**
 * (the verbatim fixtures in `projections/score.test.ts` carry all thirteen), not
 * guessed from Sleeper's docs — a wrong key here is not an error, it is a column
 * of zeroes that quietly flattens every distance it is weighted into. That is
 * also why there is no snap-count field in v1: `stats/parse.ts` says a played
 * line carries snap counts only "usually", and nothing in the repo pins the
 * key's spelling, so it waits for verification rather than shipping as a
 * maybe-dead control.
 */

/**
 * The subject positions v1 supports, and therefore the positions the picker
 * offers and the `positions=` filter accepts. The catalogue below is offensive
 * production + age + skill-market values, so a K/DEF/IDP subject would have no
 * meaningful defaults — widening this list means widening the catalogue first.
 */
export const COMPS_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

export type CompsPosition = (typeof COMPS_POSITIONS)[number];

export type CompsFieldFamily = "production" | "profile" | "market";

export type CompsField = {
  /** The wire spelling — what `fields=` names and result payloads key on. */
  key: string;
  label: string;
  family: CompsFieldFamily;
  /**
   * The stored stat line's spelling of this field; production only, and only
   * where the value is read straight off a line. Absent from a played line
   * means the event didn't happen, so assembly reads it as a real zero — the
   * opposite of the market fields' null-is-unknown.
   */
  statKey?: string;
  /**
   * A production field computed at assembly from verified keys rather than
   * read off a line — the two usage shares. A derived field is already a rate,
   * so it carries no statKey, is never divided by games, and is *nullable*
   * (null where the season's lines name no team, or the team keys aren't in
   * that season's feed) — which is why none is ever defaulted: weighting one
   * excludes the seasons that can't answer it, a press the reader makes.
   */
  derived?: true;
  /**
   * Whether the per-game basis divides this field by games played. True for
   * exactly the production fields: age-per-game and KTC-per-game are nonsense,
   * and saying so here once is what keeps the basis toggle from having to know
   * which fields it applies to.
   */
  perGame: boolean;
  /**
   * Default weight per position, 0–100. A position absent here defaults the
   * field to 0 — which is why every market field's map is empty: a defaulted
   * market field would silently exclude every unpriced player from everyone's
   * first result set, and market value answers a different question than
   * football similarity anyway. Enabling one is a deliberate press.
   */
  defaultWeights: Partial<Record<CompsPosition, number>>;
};

export const COMPS_FIELDS: readonly CompsField[] = [
  // Production — Sleeper's own stat-key spellings, totals in the pool, divided
  // by games under the per-game basis.
  {
    key: "pass_att",
    label: "Pass attempts",
    family: "production",
    statKey: "pass_att",
    perGame: true,
    defaultWeights: { QB: 80 },
  },
  {
    key: "pass_cmp",
    label: "Completions",
    family: "production",
    statKey: "pass_cmp",
    perGame: true,
    defaultWeights: { QB: 40 },
  },
  {
    key: "pass_yd",
    label: "Passing yards",
    family: "production",
    statKey: "pass_yd",
    perGame: true,
    defaultWeights: { QB: 100 },
  },
  {
    key: "pass_td",
    label: "Passing TDs",
    family: "production",
    statKey: "pass_td",
    perGame: true,
    defaultWeights: { QB: 80 },
  },
  {
    key: "pass_int",
    label: "Interceptions",
    family: "production",
    statKey: "pass_int",
    perGame: true,
    defaultWeights: { QB: 40 },
  },
  {
    key: "rush_att",
    label: "Rush attempts",
    family: "production",
    statKey: "rush_att",
    perGame: true,
    defaultWeights: { RB: 100 },
  },
  {
    key: "rush_yd",
    label: "Rushing yards",
    family: "production",
    statKey: "rush_yd",
    perGame: true,
    // A quarterback's rushing profile is part of what kind of quarterback he
    // is — the one field whose default varies by position rather than merely
    // applying to several.
    defaultWeights: { RB: 100, QB: 60 },
  },
  {
    key: "rush_td",
    label: "Rushing TDs",
    family: "production",
    statKey: "rush_td",
    perGame: true,
    defaultWeights: { RB: 60 },
  },
  {
    key: "rush_share",
    label: "Rush share %",
    family: "production",
    derived: true,
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "rec_tgt",
    label: "Targets",
    family: "production",
    statKey: "rec_tgt",
    perGame: true,
    defaultWeights: { WR: 100, TE: 100, RB: 60 },
  },
  {
    key: "rec",
    label: "Receptions",
    family: "production",
    statKey: "rec",
    perGame: true,
    defaultWeights: { WR: 80, TE: 80, RB: 60 },
  },
  {
    key: "rec_yd",
    label: "Receiving yards",
    family: "production",
    statKey: "rec_yd",
    perGame: true,
    defaultWeights: { WR: 100, TE: 100, RB: 40 },
  },
  {
    key: "rec_td",
    label: "Receiving TDs",
    family: "production",
    statKey: "rec_td",
    perGame: true,
    defaultWeights: { WR: 60, TE: 60 },
  },
  // The two usage shares — the player's count over his team's count in the
  // games he played, with the team read off each stored week rather than the
  // profile, so a traded player's share is honest on both sides of the move.
  // Derived from verified keys (`rec_tgt`, `rush_att`) — this is the only kind
  // of "advanced stat" the feed can support: it publishes no air-yards or
  // route data, so anything finer would be a column of zeroes wearing a label.
  {
    key: "tgt_share",
    label: "Target share %",
    family: "production",
    derived: true,
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "fum_lost",
    label: "Fumbles lost",
    family: "production",
    statKey: "fum_lost",
    perGame: true,
    // Available, never defaulted: a count this small is mostly noise at season
    // grain, and a default that adds noise to every first board earns nothing.
    defaultWeights: {},
  },

  // Profile.
  {
    key: "age",
    label: "Age",
    family: "profile",
    perGame: false,
    defaultWeights: { QB: 60, RB: 60, WR: 60, TE: 60 },
  },
  // Career-to-date production entering the season, derived from the pool's own
  // prior seasons at read time (`withCareerValues`) — strictly *before* this
  // one, the market anchor's own semantics, so a season can't be compared on
  // points it hadn't scored yet. Corpus-relative: "career" reaches as far as
  // the stats archive has backfilled, and a first stored season answers null
  // (a rookie has no prior form, which is a fact and not a zero).
  {
    key: "career_ppg",
    label: "Career PPR/g",
    family: "profile",
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "prev3_ppg",
    label: "Prev 3 seasons PPR/g",
    family: "profile",
    perGame: false,
    defaultWeights: {},
  },

  // Market — all nullable (absent is unknown, never zero), all defaulting to 0:
  // weighting one excludes every unpriced candidate, which the editor says out
  // loud rather than the defaults doing silently.
  {
    key: "ktc_sf",
    label: "KTC (Superflex)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "ktc_oneqb",
    label: "KTC (1QB)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
  // KTC's history read at the same anchor: the career-high superflex value on
  // record entering the season, and the 90-day move into it (negative means
  // falling). Superflex only — the dominant board; a 1QB pair would double the
  // bay for the four leagues in a hundred that read it.
  {
    key: "ktc_peak_sf",
    label: "KTC peak (SF)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "ktc_trend_sf",
    label: "KTC 90-day trend (SF)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "adp_dynasty",
    label: "ADP (Dynasty)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
  {
    key: "adp_redraft",
    label: "ADP (Redraft)",
    family: "market",
    perGame: false,
    defaultWeights: {},
  },
];

const byKey = new Map(COMPS_FIELDS.map((field) => [field.key, field]));

/** The catalogue entry for a wire key, or undefined for a key it never held. */
export function compsField(key: string): CompsField | undefined {
  return byKey.get(key);
}

/** Whether `position` is one this tool supports as a subject. */
export function isCompsPosition(value: string): value is CompsPosition {
  return (COMPS_POSITIONS as readonly string[]).includes(value);
}

/**
 * The default board for a position: every field carrying a positive default
 * weight there, in catalogue order. This is what an explicit `fields=` replaces
 * — and it is never empty for a supported position, which `fields.test.ts`
 * pins, because a position whose defaults produce no board would turn the
 * tool's first answer into a 400.
 */
export function defaultWeightsFor(
  position: CompsPosition,
): { key: string; weight: number }[] {
  const defaults: { key: string; weight: number }[] = [];
  for (const field of COMPS_FIELDS) {
    const weight = field.defaultWeights[position];
    if (weight !== undefined && weight > 0) {
      defaults.push({ key: field.key, weight });
    }
  }
  return defaults;
}
