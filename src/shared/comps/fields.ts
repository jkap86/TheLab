/**
 * The Comps field catalogue — every dimension a comparison can weigh, said once.
 *
 * Both ends of the wire read this module (the `projections/slots.ts` precedent):
 * the server parser validates `fields=` against it and resolves per-position
 * defaults from it, and the client's field editor renders it and writes its
 * spellings back onto the query string. It is pure and imports nothing, so the
 * client deep-imports it and the tests load it under Node's runner.
 *
 * **Every ungated production `statKey` below is verified against stored stat
 * lines** (the verbatim fixtures in `projections/score.test.ts` carry all
 * thirteen), not guessed from Sleeper's docs — a wrong key here is not an
 * error, it is a column of zeroes that quietly flattens every distance it is
 * weighted into. An *unverified* key may ship only behind `gated`, which turns
 * that failure into an honest absence — see the flag's doc. **That is exactly
 * how the snap fields ship**: `stats/parse.ts` says a played line carries snap
 * counts only "usually" and nothing in the repo pins `off_snp`/`tm_off_snp`, so
 * the three of them (snaps, snap share, targets per snap) are gated on the
 * season's own vocabulary rather than trusted — if the keys are real they
 * work, and if a season's feed never mentions them the fields are inert and
 * say so instead of reporting that everybody played no snaps.
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
   * A production field computed at assembly rather than read off a line — the
   * usage shares and the two snap rates. A derived field is already a rate, so
   * it carries no statKey, is never divided by games, and is *nullable* (null
   * where the season's lines name no team, or the keys behind it aren't in
   * that season's feed) — which is why none is ever defaulted: weighting one
   * excludes the seasons that can't answer it, a press the reader makes.
   *
   * Assembly writes each one's numerator and denominator onto the row's
   * `rates` beside the value, which is what lets a multi-season window pool the
   * rate *exactly* rather than averaging seasons' rates into an approximation
   * of it.
   */
  derived?: true;
  /**
   * The raw stat keys a derived field is computed from, where those keys are
   * unverified — the `gated` rule for a field that reads no single line. The
   * field answers only in a season whose feed demonstrably carries **every**
   * key named here; elsewhere it is null for everyone, which is the honest
   * absence rather than a rate over a denominator that was never published.
   */
  requires?: readonly string[];
  /**
   * A line-read production field whose key is *not* verified against stored
   * lines, gated on the season's own vocabulary: absent-is-zero applies only
   * in a season where at least one stored line carries the key, and a season
   * whose feed never mentions it answers null for everyone. That is the
   * difference between the failure the header warns about and a safe one — an
   * unverified key that turns out not to exist reads as an honestly inert
   * field (dropped for the subject, exclusions counted for candidates), never
   * as a column of zeroes quietly flattening every distance. Nullable, so the
   * no-default rule applies for the derived fields' reason.
   */
  gated?: true;
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
    key: "pass_air_yd",
    label: "Passing air yards",
    family: "production",
    statKey: "pass_air_yd",
    gated: true,
    perGame: true,
    defaultWeights: {},
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
  // Air yards, gated on the season's vocabulary — the one production key in
  // the catalogue not verified against a stored line (no repo fixture carries
  // it and the feed can't be probed from here), which is exactly what `gated`
  // exists for: if the key is real it works, and if Sleeper never publishes it
  // the field is inert and says so rather than zero-filling.
  {
    key: "rec_air_yd",
    label: "Receiving air yards",
    family: "production",
    statKey: "rec_air_yd",
    gated: true,
    perGame: true,
    defaultWeights: {},
  },
  // Snaps, gated on the same terms as air yards — `stats/parse.ts` promises
  // only that a played line "usually" carries them. Weightable in its own
  // right: how often a player was on the field is the usage number the counts
  // below are all denominated by, and two players with the same targets on
  // very different snap counts are not the same player.
  {
    key: "off_snp",
    label: "Snaps",
    family: "production",
    statKey: "off_snp",
    gated: true,
    perGame: true,
    defaultWeights: {},
  },
  // The two usage shares — the player's count over his team's count in the
  // games he played, with the team read off each stored week rather than the
  // profile, so a traded player's share is honest on both sides of the move.
  // Derived from verified keys (`rec_tgt`, `rush_att`).
  {
    key: "tgt_share",
    label: "Target share %",
    family: "production",
    derived: true,
    perGame: false,
    defaultWeights: {},
  },
  // Snap share — the player's offensive snaps over his team's, read off each
  // week's own line rather than aggregated from teammates, so it is exact for a
  // traded player and needs nobody else's row to answer. The share every other
  // usage number is read against: 20% of the targets on 90% of the snaps is a
  // different player from the same targets on 45%.
  {
    key: "snap_pct",
    label: "Snap share %",
    family: "production",
    derived: true,
    requires: ["off_snp", "tm_off_snp"],
    perGame: false,
    defaultWeights: {},
  },
  // Targets per snap — how often being on the field turned into a look, which
  // separates a route-runner from a blocker at identical snap counts. The
  // numerator counts only the weeks the denominator can speak for, the rule the
  // shares above already keep.
  {
    key: "tgt_per_snap",
    label: "Targets / snap",
    family: "production",
    derived: true,
    requires: ["off_snp"],
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
  // Where the player went in the *NFL* draft, as draft capital rather than as
  // a pick number — `shared/nfl-draft/capital.ts` holds the curve and the
  // argument for it. In short: a pick number is an ordinal, so a distance over
  // it would call 1-vs-20 and 200-vs-219 the same gap, which is false in the
  // only sense a reader means. On the curve, two first-rounders are close, two
  // Day 3 picks are close, and a 1st against a 5th is far.
  //
  // Undrafted is a *value* here and not a gap: every undrafted player stands on
  // one notch just past the last pick, so they cluster and "compare this
  // undrafted breakout to other undrafted breakouts" is answerable. Null is
  // reserved for a player this app has no draft record for at all.
  //
  // Never defaulted, on the nullable rule above and with a second reason of its
  // own: the crosswalk behind it thins out in the archive seasons, so a default
  // would quietly drop the deepest end of the pool out of every first board —
  // exactly where the comps are most interesting. Weighting it is a press the
  // editor makes visible, and the exclusion count says what it cost.
  {
    key: "draft_capital",
    label: "Draft capital",
    family: "profile",
    perGame: false,
    defaultWeights: {},
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

/**
 * Whether a field can be read over a window of seasons rather than the anchor
 * season alone.
 *
 * **Derived from the family rather than flagged per field**, the
 * `DEFENSIVE_SLOTS` rule, and the family is the honest test: a window pools its
 * seasons additively, which is what a count or a usage rate *is* and what a
 * price is not. Two seasons of targets pool into targets; two seasons of KTC
 * pool into nothing anybody has a name for, and two ages into an absurdity. So
 * the production family windows and the other two read the season they are
 * anchored to — which is also where `career_ppg` and `ktc_peak_sf` already
 * live, as named answers to the one cross-season question each family has.
 */
export function compsFieldTakesWindow(field: CompsField): boolean {
  return field.family === "production";
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
