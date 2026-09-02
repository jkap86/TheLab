/**
 * The lineup-slot vocabulary: which slots exist, what fills them, and which of
 * them start nobody.
 *
 * One definition for both sides of the wire. The solver (`./optimal`) walks
 * these sets to build lineups, and the client components interpret
 * `roster_positions` with them — so they live in a module with **zero runtime
 * imports** that client code is allowed to import directly (the projections
 * barrel would drag `pg` into the bundle). Keep it dependency-free.
 */

/**
 * Which fantasy positions may fill each Sleeper lineup slot.
 *
 * `FLEX` and friends are the whole reason the lineup solve isn't a sort: they
 * overlap without nesting. `WRRB_FLEX` takes RB/WR and `REC_FLEX` takes WR/TE,
 * so neither contains the other, and a league with both (there are leagues with
 * both) can't be filled correctly by handling slots one at a time — see
 * `optimalLineup` in `./optimal`.
 */
export const SLOT_POSITIONS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  K: ["K"],
  DEF: ["DEF"],
  DL: ["DL"],
  LB: ["LB"],
  DB: ["DB"],
  FLEX: ["RB", "WR", "TE"],
  WRRB_FLEX: ["RB", "WR"],
  REC_FLEX: ["WR", "TE"],
  SUPER_FLEX: ["QB", "RB", "WR", "TE"],
  IDP_FLEX: ["DL", "LB", "DB"],
};

/** Slots that hold players without starting them. */
export const NON_STARTING_SLOTS = new Set(["BN", "IR", "TAXI"]);

/** Individual defenders — the defensive positions minus the team unit. */
const IDP_POSITIONS = new Set(["DL", "LB", "DB"]);

/** The positions Sleeper barely projects — team defence and IDP. */
const DEFENSIVE_POSITIONS = new Set(["DEF", ...IDP_POSITIONS]);

/**
 * Slots only defensive players can fill.
 *
 * Derived from {@link SLOT_POSITIONS} rather than listed, so a new IDP slot is
 * defensive here the moment the solver learns it — this set gates the "your
 * projections read low" caveat, and a slot missing from it silences the warning
 * for exactly the leagues that need it.
 */
export const DEFENSIVE_SLOTS = new Set(
  Object.entries(SLOT_POSITIONS)
    .filter(([, positions]) => positions.every((p) => DEFENSIVE_POSITIONS.has(p)))
    .map(([slot]) => slot),
);

/**
 * Slots only *individual* defenders can fill — {@link DEFENSIVE_SLOTS} without
 * `DEF`, derived on the same terms so a new IDP slot joins it the moment the
 * solver learns it.
 *
 * The split from `DEFENSIVE_SLOTS` is not pedantry: nearly every league starts a
 * team defence, so that set says almost nothing about what game a league is
 * playing, while starting a linebacker makes it a different one — a roster twice
 * the usual depth, priced off a board KTC doesn't publish. The league filters
 * narrow on this set for that reason; the projections caveat still wants the
 * wider one, since Sleeper under-projects the team unit too.
 */
export const IDP_SLOTS = new Set(
  Object.entries(SLOT_POSITIONS)
    .filter(([, positions]) => positions.every((p) => IDP_POSITIONS.has(p)))
    .map(([slot]) => slot),
);
