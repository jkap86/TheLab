import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ADP_PEAK,
  ADP_RANGE_PRESETS,
  DEFAULT_ADP_ROUNDS,
  DEFAULT_ADP_STEEPNESS,
  adpBoardRead,
  adpBoardRows,
  adpListIdentity,
  adpNarrowingCount,
  adpValueRead,
  boardLabel,
  defaultAdpControls,
  deriveScoring,
  previewAdpPool,
  previewAdpValue,
  rookieOrderingBoard,
  shownAdpBoards,
  startupPricingBoard,
  steepnessSummary,
  seasonOptions,
  rangeBounds,
  rangeLabel,
  rangeSummary,
  seedFromLeague,
  todayIso,
  toggleAdpBoard,
  type AdpControls,
  type AdpRange,
} from "./adp-controls.ts";
// Relative with the extension, like `adp-controls` own import of this module:
// Node's test runner strips types but does not know the `@/*` aliases.
import { ADP_VALUE_PARAMS } from "../../shared/manager/adp-value.ts";
import { DEFAULT_LEAGUE_FILTERS } from "./league-filters/defaults.ts";
import type { FilterRule, LeagueFilters } from "./league-filters/types.ts";
import { ALL_LEAGUES, type LeagueScope } from "./league-scope.ts";
import type { ManagerLeague } from "@/shared/manager";
import type { AdpPlayerPayload } from "@/shared/contract";

/** A fixed "today" so the relative presets resolve to asserted dates. */
const TODAY = "2026-07-31";

/** The season a board opens on, as the manager layout supplies it. */
const SEASON = "2026";

const league = (over: Partial<ManagerLeague>): ManagerLeague => ({
  league_id: "1",
  name: "Test League",
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: null,
  roster_positions: null,
  scoring_settings: null,
  ...over,
});

/** Parse a query string back to a plain object for order-independent asserts. */
const params = (query: string | URLSearchParams) =>
  Object.fromEntries(new URLSearchParams(query).entries());

/**
 * The board's read with no league rules resolved — the shape every one of these
 * assertions is written against unless it is about the scope itself.
 */
const board = (controls: AdpControls, scope: LeagueScope = ALL_LEAGUES) =>
  adpBoardRead(controls, scope, TODAY);

/** Its query string, as a plain object. */
const boardParams = (controls: AdpControls, scope: LeagueScope = ALL_LEAGUES) =>
  params(board(controls, scope).search);

/** League rules with one list written, over the neutral selection. */
const rules = (over: Partial<LeagueFilters>): LeagueFilters => ({
  ...DEFAULT_LEAGUE_FILTERS,
  ...over,
});

/** Controls with those rules on them. */
const withRules = (over: Partial<LeagueFilters>): AdpControls => ({
  ...defaultAdpControls(SEASON),
  leagueRules: rules(over),
});

describe("adpBoardRead", () => {
  test("the default board sends one whole season of startups, snake+linear, and nothing else", () => {
    // The rounds bound is the one filter the board opens *with*: pooling rookie
    // drafts into a startup average prices every rookie off two different games.
    assert.deepEqual(boardParams(defaultAdpControls(SEASON)), {
      limit: "1000",
      season: "2026",
      draft_type: "snake,linear",
      rounds_min: "12",
    });
  });

  test("an unnarrowed board is a GET with no body", () => {
    const read = board(defaultAdpControls(SEASON));
    assert.equal(read.method, "GET");
    assert.equal(read.body, null);
  });

  test("the default board is the startup bucket, not a second spelling of it", () => {
    // Pinned through the exported constant rather than the literal, so the
    // default and what the trigger measures departure from cannot drift apart.
    assert.equal(defaultAdpControls(SEASON).rounds, DEFAULT_ADP_ROUNDS);
    assert.equal(
      board(defaultAdpControls(SEASON)).key,
      board({ ...defaultAdpControls(SEASON), rounds: "full" }).key,
    );
  });

  test("season is always sent, narrowed window or not", () => {
    // The route applies its own DEFAULT_SEASON only when the caller bounded the
    // board neither way, so an omitted season is a default that switches itself
    // off the moment a date bound appears — and the board silently goes back to
    // pooling every season, which is what makes it wrong at every row.
    for (const preset of ["30d", "90d", "all"] as const) {
      const query = boardParams({
        ...defaultAdpControls(SEASON),
        range: { preset, from: null, to: null },
      });
      assert.equal(query.season, "2026");
    }
  });

  test("pooling every season is stated, not left to a missing parameter", () => {
    const query = boardParams({ ...defaultAdpControls(SEASON), season: "all" });
    assert.equal(query.season, "all");
  });

  test("an unbounded range sends no date at all", () => {
    const all = boardParams({
      ...defaultAdpControls(SEASON),
      range: { preset: "all", from: null, to: null },
    });
    assert.equal("start_after" in all, false);
    assert.equal("start_before" in all, false);
  });

  test("a custom range sends the ends it has, and only those", () => {
    const query = (range: AdpRange) =>
      boardParams({ ...defaultAdpControls(SEASON), range });

    assert.deepEqual(
      query({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      {
        limit: "1000",
        season: "2026",
        draft_type: "snake,linear",
        rounds_min: "12",
        start_after: "2026-06-01",
        start_before: "2026-07-31",
      },
    );
    assert.equal("start_before" in query({ preset: "custom", from: "2026-06-01", to: null }), false);
    assert.equal("start_after" in query({ preset: "custom", from: null, to: "2026-07-31" }), false);
  });

  test("the league rules never travel as themselves — only their answer does", () => {
    // They are a predicate engine over Sleeper's blobs, so what reaches the
    // route is the ids they resolved to. A board carrying rules and an empty
    // scope is an *unnarrowed* board: the caller resolves them, and until it
    // has a league list to resolve against there is nothing honest to send.
    const narrowed = withRules({ type: "2", settings: [{ key: "teams", op: "eq", value: 12 }] });
    assert.deepEqual(
      boardParams(narrowed),
      boardParams(defaultAdpControls(SEASON)),
    );
    for (const key of ["scoring", "superflex", "best_ball", "teams_min", "type"]) {
      assert.equal(key in boardParams(narrowed), false);
    }
  });

  test("a resolved scope rides as league ids, sorted", () => {
    // Sorted is not cosmetic: unsorted, the key would depend on the order the
    // leagues happened to arrive in, so one rule set becomes two cache entries.
    const include = boardParams(defaultAdpControls(SEASON), {
      kind: "include",
      ids: ["3", "1", "2"],
    });
    assert.equal(include.league_id, "1,2,3");
    const exclude = boardParams(defaultAdpControls(SEASON), {
      kind: "exclude",
      ids: ["9", "8"],
    });
    assert.equal(exclude.xleague_id, "8,9");
    assert.equal("league_id" in exclude, false);
  });

  test("rules that matched nothing send an empty list, not no list at all", () => {
    // The one case where the two spellings mean opposite things: an *absent*
    // parameter is no narrowing, where a present-and-empty one is "no league
    // matched", which is a real answer and an empty board.
    const query = board(defaultAdpControls(SEASON), { kind: "include", ids: [] });
    assert.equal(query.search.has("league_id"), true);
    assert.equal(query.search.get("league_id"), "");
  });

  test("a scope too long for a request line moves to a body, and the key doesn't", () => {
    // GET and POST are one question: the query string is identical bar the ids,
    // and the *key* inlines them either way — two league sets that differ are
    // two boards whatever transport carried them.
    const ids = Array.from({ length: 600 }, (_, i) => String(i));
    const read = board(defaultAdpControls(SEASON), { kind: "include", ids });
    assert.equal(read.method, "POST");
    assert.deepEqual(read.body, { leagues: [...ids].sort() });
    assert.equal(read.search.has("league_id"), false);
    assert.ok(read.key.includes("league_id="));

    // And the same ids sent the short way file under the same key.
    const short = board(defaultAdpControls(SEASON), { kind: "include", ids });
    assert.equal(read.key, short.key);
  });

  test("two scopes that differ are two boards", () => {
    const a = board(defaultAdpControls(SEASON), { kind: "include", ids: ["1"] });
    const b = board(defaultAdpControls(SEASON), { kind: "include", ids: ["2"] });
    const none = board(defaultAdpControls(SEASON));
    assert.equal(new Set([a.key, b.key, none.key]).size, 3);
  });

  test("the boards selection is display state, never a query parameter", () => {
    // The route answers both league-type boards on every fetch; which is drawn
    // is the drawer's business. Sending it would also split the client cache
    // into two entries holding identical payloads.
    const both = board(defaultAdpControls(SEASON)).key;
    const one = board({ ...defaultAdpControls(SEASON), boards: "dynasty" }).key;
    assert.equal(both, one);
    assert.equal("league_type" in params(board(defaultAdpControls(SEASON)).search), false);
  });

  test("steepness is a value-curve knob, not a board filter — never sent here", () => {
    // It drives the Leagues-tab team value, not which drafts /api/adp averages.
    const flat = board({ ...defaultAdpControls(SEASON), steepness: 3 });
    const steep = board({ ...defaultAdpControls(SEASON), steepness: 6 });
    assert.equal(flat.key, steep.key);
    assert.equal("steepness" in params(flat.search), false);
  });

  test("the rounds buckets bound one side each, all-rounds neither", () => {
    const round = (rounds: AdpControls["rounds"]) =>
      boardParams({ ...defaultAdpControls(SEASON), rounds });
    assert.equal("rounds_min" in round("all"), false);
    assert.equal("rounds_max" in round("all"), false);
    assert.deepEqual(
      { min: round("rookie").rounds_min, max: round("rookie").rounds_max },
      { min: undefined, max: "5" },
    );
    assert.deepEqual(
      { min: round("full").rounds_min, max: round("full").rounds_max },
      { min: "12", max: undefined },
    );
  });

  test("a board is always over snake and linear drafts, never auctions", () => {
    // An auction's `pick_no` is nomination order rather than a draft slot, so
    // its "ADP" is not one. It stopped being a control when that chip became the
    // startup/rookie question readers were actually asking it, so the parameter
    // is now a constant — and this is what pins it.
    for (const rounds of ["all", "rookie", "full"] as const) {
      const query = boardParams({ ...defaultAdpControls(SEASON), rounds });
      assert.equal(query.draft_type, "snake,linear");
    }
  });
});

describe("adpListIdentity", () => {
  /** The board as it opens, and that board with one field written. */
  const base = defaultAdpControls(SEASON);
  const identity = (over: Partial<AdpControls> = {}, scope: LeagueScope = ALL_LEAGUES) =>
    adpListIdentity({ ...base, ...over }, scope, TODAY);

  test("every change to the population is a different list", () => {
    // Each of these narrows *which drafts are averaged*, so the players on the
    // board and their order both move: a reader four hundred rows deep is
    // nowhere in particular afterwards, which is what the scroll reset is for.
    const changes: Partial<AdpControls>[] = [
      { season: "2025" },
      { season: "all" },
      { rounds: "rookie" },
      { range: { preset: "30d", from: null, to: null } },
      { range: { preset: "lookback", from: null, to: null, days: 45 } },
      { range: { preset: "custom", from: "2026-01-01", to: "2026-06-30" } },
    ];
    for (const change of changes) {
      assert.notEqual(
        identity(change),
        identity(),
        `${JSON.stringify(change)} should be a different list`,
      );
    }
    // And each of them is a different list from the others, not merely from the
    // default — one identity standing for two populations is a board that
    // silently keeps a stale offset.
    const all = changes.map((change) => identity(change));
    assert.equal(new Set(all).size, all.length);
  });

  test("a different set of leagues is a different list", () => {
    // The rules themselves are not in the identity — their *answer* is, which is
    // what makes two rule sets that leave the same leagues one board and keeps
    // the reader's place through a rule respelled.
    const ids = (values: string[]): LeagueScope => ({ kind: "include", ids: values });
    assert.notEqual(identity({}, ids(["1", "2"])), identity());
    assert.notEqual(identity({}, ids(["1", "2"])), identity({}, ids(["1", "3"])));
    assert.equal(identity({}, ids(["1", "2"])), identity({}, ids(["2", "1"])));
    // And the rules alone move nothing, because nothing about the fetch moved.
    assert.equal(identity({ leagueRules: rules({ type: "2" }) }), identity());
  });

  test("swapping the market shown is a different list, though it narrows nothing", () => {
    // The fetch is identical — `boards` is display state and never reaches the
    // query — but `adpBoardRows` drops the rows a single board can't average and
    // re-sorts on that board's column, so the list under the reader is not the
    // one they were reading.
    assert.equal(board(base).key, board({ ...base, boards: "dynasty" }).key);
    const seen = new Set([identity(), identity({ boards: "redraft" }), identity({ boards: "dynasty" })]);
    assert.equal(seen.size, 3);
  });

  test("the curve alone keeps the reader where they are", () => {
    // The one change that must *not* reset. It is dragged a notch at a time
    // while the reader watches one player's value bend, and it reorders nothing
    // — every row keeps its rank and its place.
    for (const steepness of [1, 3, DEFAULT_ADP_STEEPNESS, 6, 9]) {
      assert.equal(identity({ steepness }), identity());
    }
  });

  test("a window respelled to the same dates is the same list", () => {
    // "All time" and a custom window with neither end set resolve to the same
    // bounds, so the fetch is the same fetch. Reading the identity off the query
    // string rather than off the raw fields is what gets this right.
    assert.equal(
      identity({ range: { preset: "custom", from: null, to: null } }),
      identity({ range: { preset: "all", from: null, to: null } }),
    );
    // Likewise a lookback spelled as its named preset.
    assert.equal(
      identity({ range: { preset: "lookback", from: null, to: null, days: 30 } }),
      identity({ range: { preset: "30d", from: null, to: null } }),
    );
  });

  test("it is the read's key and the shown boards, and nothing retyped", () => {
    // The agreement that keeps a filter added to `adpBoardRead` resetting the
    // scroll without this function being touched.
    const controls: AdpControls = { ...base, season: "2025", boards: "dynasty" };
    const scope: LeagueScope = { kind: "include", ids: ["7"] };
    const id = adpListIdentity(controls, scope, TODAY);
    assert.ok(id.startsWith(adpBoardRead(controls, scope, TODAY).key));
    assert.ok(id.endsWith("dynasty"));
  });
});

/**
 * The two boards a rookie *pick* is valued off, which are the panel's own
 * population asked twice with the round bounds fixed.
 *
 * The property under test is a separation the compiler cannot hold: which board
 * is on *display* is presentation state, and it must not reach a valuation. A
 * reader switching the panel to "Rookie" was repricing every pick on the trades
 * board off rookie-draft ADP, where the 1.01 sits at ~1 and the value curve
 * reads it as the most valuable asset in dynasty football.
 */
describe("rookieOrderingBoard / startupPricingBoard", () => {
  const rounds = (controls: AdpControls) => boardParams(controls);

  test("each fixes its own end of the round scale, whatever is displayed", () => {
    for (const shown of ["all", "rookie", "full"] as const) {
      const controls = { ...defaultAdpControls(SEASON), rounds: shown };
      assert.deepEqual(
        {
          min: rounds(rookieOrderingBoard(controls)).rounds_min,
          max: rounds(rookieOrderingBoard(controls)).rounds_max,
        },
        { min: undefined, max: "5" },
        `displayed ${shown}`,
      );
      assert.deepEqual(
        {
          min: rounds(startupPricingBoard(controls)).rounds_min,
          max: rounds(startupPricingBoard(controls)).rounds_max,
        },
        { min: "12", max: undefined },
        `displayed ${shown}`,
      );
    }
  });

  test("the thresholds are the drawer's own, not a second spelling", () => {
    // One definition of "a rookie draft" — the chip's and the valuation's. A
    // second threshold here would drift silently, and the symptom would be a
    // ladder built from a population the panel never describes.
    const base = defaultAdpControls(SEASON);
    assert.deepEqual(
      rounds(rookieOrderingBoard(base)),
      rounds({ ...base, rounds: "rookie" }),
    );
    assert.deepEqual(
      rounds(startupPricingBoard(base)),
      rounds({ ...base, rounds: "full" }),
    );
  });

  /**
   * Everything that describes *which market* has to survive, or the ordering
   * and the pricing are about different leagues — an SF rookie order priced off
   * a 1QB startup board is wrong at every quarterback on the ladder.
   */
  test("every other axis reaches both boards unchanged", () => {
    const controls: AdpControls = {
      ...defaultAdpControls(SEASON),
      season: "2025",
      range: { preset: "custom", from: "2025-05-01", to: "2025-06-30" },
      // The league rules ride on both boards too, though they reach the wire as
      // a resolved scope rather than as themselves — which is what the scope
      // assertion below is for.
      leagueRules: rules({ slots: [{ key: "QB+SF", op: "gte", value: 2 }] }),
      rounds: "all",
    };
    const shared = {
      limit: "1000",
      season: "2025",
      draft_type: "snake,linear",
      start_after: "2025-05-01",
      start_before: "2025-06-30",
    };
    assert.deepEqual(rounds(rookieOrderingBoard(controls)), {
      ...shared,
      rounds_max: "5",
    });
    assert.deepEqual(rounds(startupPricingBoard(controls)), {
      ...shared,
      rounds_min: "12",
    });

    // The rules survive as a scope, which is what keeps the ordering and the
    // pricing about one population: an SF rookie order priced off a 1QB startup
    // board is wrong at every quarterback on the ladder.
    const scope: LeagueScope = { kind: "include", ids: ["4", "9"] };
    for (const derived of [rookieOrderingBoard(controls), startupPricingBoard(controls)]) {
      assert.equal(
        params(adpBoardRead(derived, scope, TODAY).search).league_id,
        "4,9",
      );
    }
  });

  /**
   * The pricing board is the *displayed* board under the default, which is what
   * makes the second fetch free in the common case: React Query keys on the
   * query string, so the two resolve to one entry and one request.
   */
  test("the pricing board is the displayed one on the default board", () => {
    const base = defaultAdpControls(SEASON);
    assert.equal(DEFAULT_ADP_ROUNDS, "full");
    assert.equal(board(startupPricingBoard(base)).key, board(base).key);
    // And the ordering board is genuinely a different one, or there would be no
    // ordering to read.
    assert.notEqual(board(rookieOrderingBoard(base)).key, board(base).key);
  });

  test("neither reads the display-only fields", () => {
    // `boards` and `steepness` narrow no population — they choose which columns
    // are drawn and how an averaged ADP converts to value — so they leave the
    // query strings alone here exactly as they do for the board itself.
    const controls: AdpControls = {
      ...defaultAdpControls(SEASON),
      boards: "redraft",
      steepness: 6,
    };
    assert.equal(
      board(rookieOrderingBoard(controls)).key,
      board(rookieOrderingBoard(defaultAdpControls(SEASON))).key,
    );
  });
});

describe("adpValueRead", () => {
  const value = (controls: AdpControls, scope: LeagueScope = ALL_LEAGUES) =>
    adpValueRead(controls, scope, TODAY);
  const valueParams = (controls: AdpControls, scope: LeagueScope = ALL_LEAGUES) =>
    params(value(controls, scope).search);

  test("the default board is the curve, the season and the startup bound", () => {
    assert.deepEqual(valueParams(defaultAdpControls(SEASON)), {
      steepness: String(DEFAULT_ADP_STEEPNESS),
      board_season: "2026",
      rounds_min: "12",
    });
  });

  test("scoring and superflex never cross — they are the league's, not the reader's", () => {
    // A superflex roster priced off 1QB drafts is wrong at every position, so
    // `adpBoardFor` matches both per league. They are not expressible from here
    // any more either: the drawer's chips for both became league *rules*, and a
    // rule set says which leagues' drafts are on the board rather than which
    // board a given roster reads.
    const query = valueParams(
      withRules({ slots: [{ key: "QB+SF", op: "lte", value: 1 }], scoring: [{ key: "rec", op: "gte", value: 1 }] }),
    );
    assert.equal("scoring" in query, false);
    assert.equal("superflex" in query, false);
  });

  test("the names are the server's own, not a second spelling of them", () => {
    // A query string is invisible to the compiler, so renaming one end and not
    // the other is a filter that silently stops applying rather than an error —
    // the route would fall back to the unnarrowed board and every card would go
    // on answering with the wrong number. One definition, read from both sides.
    const query = valueParams(defaultAdpControls(SEASON));
    assert.ok(ADP_VALUE_PARAMS.boardSeason in query);
    assert.ok(ADP_VALUE_PARAMS.steepness in query);
  });

  test("the season travels under its own name, never as `season`", () => {
    // `?season` belongs to `resolveManagerRequest` on every route under that
    // prefix, where it picks which leagues' rosters are being priced. Sharing the
    // name would make moving the drawer to 2024 swap the card list out from
    // under itself.
    const query = valueParams({ ...defaultAdpControls(SEASON), season: "2024" });
    assert.equal(query.board_season, "2024");
    assert.equal("season" in query, false);
  });

  test("the population axes are the ones `adpBoardFor` left broad", () => {
    const query = valueParams({
      ...defaultAdpControls(SEASON),
      range: { preset: "custom", from: "2026-06-01", to: "2026-07-31" },
      rounds: "rookie",
    });
    assert.deepEqual(query, {
      steepness: String(DEFAULT_ADP_STEEPNESS),
      board_season: "2026",
      start_after: "2026-06-01",
      start_before: "2026-07-31",
      rounds_max: "5",
    });
  });

  test("the league scope reaches the cards, spelled exactly as the board spells it", () => {
    // The whole reason these two routes answer a POST: a card priced on a
    // different board from the drawer above it is the two-answers-to-one-question
    // this path exists to close, and a narrowed board's ids outgrow a request
    // line. One spelling, so the two reads cannot narrow differently.
    const scope: LeagueScope = { kind: "exclude", ids: ["5", "2"] };
    assert.equal(valueParams(defaultAdpControls(SEASON), scope).xleague_id, "2,5");

    const ids = Array.from({ length: 600 }, (_, i) => String(i));
    const long = value(defaultAdpControls(SEASON), { kind: "include", ids });
    assert.equal(long.method, "POST");
    assert.deepEqual(long.body, { leagues: [...ids].sort() });
    assert.ok(long.key.includes("league_id="));
  });

  test("the display-only selection is not on it, the same as the board query", () => {
    // Which of the two markets is drawn is the drawer's business; the route
    // reads each league's own type (`getLeagueAdpBoards`) to pick a side.
    assert.equal(
      value(defaultAdpControls(SEASON)).key,
      value({ ...defaultAdpControls(SEASON), boards: "dynasty" }).key,
    );
  });

  test("the curve is on this one, where the board query refuses it", () => {
    // The mirror of `adpBoardRead`'s own rule: steepness converts an averaged
    // ADP into value, so it means nothing to `/api/adp` and everything here.
    const steep = valueParams({ ...defaultAdpControls(SEASON), steepness: 6 });
    assert.equal(steep.steepness, "6");
    assert.equal(
      "steepness" in boardParams({ ...defaultAdpControls(SEASON), steepness: 6 }),
      false,
    );
  });
});

describe("steepnessSummary", () => {
  test("reads the curve as what the last starter is worth", () => {
    // 2^-halvings a full pool deep. The default halves four times, so the last
    // startable pick is ~1/16 of the 1.01.
    assert.equal(steepnessSummary(4), "last starter ≈ 6% of the 1.01");
    assert.equal(steepnessSummary(2), "last starter ≈ 25% of the 1.01");
  });

  test("the steep end keeps a digit rather than rounding to nothing", () => {
    // Rounded whole, the top of the range reads "0%", which says the curve
    // stopped moving where it is in fact still halving.
    assert.equal(steepnessSummary(8), "last starter ≈ 0.4% of the 1.01");
  });
});

describe("previewAdpPool", () => {
  const size = (rule: FilterRule) => rules({ settings: [rule] });

  test("uses an exact size rule when the board carries one", () => {
    assert.equal(previewAdpPool(size({ key: "teams", op: "eq", value: 10 })), 10 * 9);
  });

  test("only an equality answers it — a bound is a range of pools, not one", () => {
    // The chip this replaced could say nothing but "12-team", so it was a number
    // or "all". A rule can also say `teams >= 12`, and a preview that guessed at
    // an end of that would quote a pool no filter asked for.
    for (const op of ["gte", "lte", "gt", "lt", "ne"] as const) {
      assert.equal(previewAdpPool(size({ key: "teams", op, value: 10 })), 12 * 9);
    }
  });

  test("no rule, or a junk size, falls back to a typical 12-team league", () => {
    // The drawer's board belongs to no league, so the preview needs a premise;
    // a zero or unparseable one would collapse the curve rather than pick a pool.
    assert.equal(previewAdpPool(DEFAULT_LEAGUE_FILTERS), 12 * 9);
    assert.equal(previewAdpPool(size({ key: "teams", op: "eq", value: 0 })), 12 * 9);
    assert.equal(previewAdpPool(size({ key: "teams", op: "eq", value: 10.5 })), 12 * 9);
  });
});

describe("previewAdpValue", () => {
  test("the top of the board is the peak, and value falls down it", () => {
    assert.equal(previewAdpValue(1, DEFAULT_LEAGUE_FILTERS, DEFAULT_ADP_STEEPNESS), ADP_PEAK);
    assert.ok(
      previewAdpValue(50, DEFAULT_LEAGUE_FILTERS, DEFAULT_ADP_STEEPNESS) >
        previewAdpValue(120, DEFAULT_LEAGUE_FILTERS, DEFAULT_ADP_STEEPNESS),
    );
  });

  test("a steeper curve is worth less everywhere but the very top", () => {
    // What the slider does, and the reason the preview re-prices as it moves.
    assert.ok(previewAdpValue(40, DEFAULT_LEAGUE_FILTERS, 6) <
        previewAdpValue(40, DEFAULT_LEAGUE_FILTERS, 3));
    assert.equal(
      previewAdpValue(1, DEFAULT_LEAGUE_FILTERS, 6),
      previewAdpValue(1, DEFAULT_LEAGUE_FILTERS, 3),
    );
  });
});

describe("deriveScoring", () => {
  test("buckets on rec, treating a missing rec as standard", () => {
    assert.equal(deriveScoring(null), "std");
    assert.equal(deriveScoring({}), "std");
    assert.equal(deriveScoring({ rec: 0 }), "std");
    assert.equal(deriveScoring({ rec: 0.5 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 0.75 }), "half_ppr");
    assert.equal(deriveScoring({ rec: 1 }), "ppr");
  });
});

describe("seedFromLeague", () => {
  test("fills the league settings as rules, and leaves the rest", () => {
    const base: AdpControls = {
      ...defaultAdpControls(SEASON),
      range: { preset: "custom", from: "2025-05-01", to: null },
      rounds: "rookie",
    };
    const seeded = seedFromLeague(
      base,
      league({
        total_rosters: 10,
        settings: { type: 2, best_ball: 1 },
        roster_positions: ["QB", "RB", "WR", "SUPER_FLEX", "BN"],
        scoring_settings: { rec: 0.5 },
      }),
    );
    // The league's type seeds which board the list displays — the market this
    // league is actually in — since it is no longer a fetch filter to set.
    assert.equal(seeded.boards, "dynasty");
    assert.equal(seeded.leagueRules.bestBall, "yes");
    assert.deepEqual(seeded.leagueRules.settings, [{ key: "teams", op: "eq", value: 10 }]);
    // The *buckets*, not the league's exact numbers: `rec = 0.5` is true and far
    // narrower than the population this league belongs to, which is what
    // `SCORING_SQL` groups by — a seed has to land there or "match a league"
    // hands back a board of a dozen drafts.
    assert.deepEqual(seeded.leagueRules.scoring, [
      { key: "rec", op: "gte", value: 0.5 },
      { key: "rec", op: "lt", value: 1 },
    ]);
    assert.deepEqual(seeded.leagueRules.slots, [{ key: "QB+SF", op: "gte", value: 2 }]);
    // The season *is* a league setting: matching a 2025 league while leaving the
    // board on this year prices it against a market it was never in.
    assert.equal(seeded.season, "2026");
    assert.equal(
      seedFromLeague(base, league({ season: "2024" })).season,
      "2024",
    );
    // Not league settings — left exactly as they were.
    assert.deepEqual(seeded.range, { preset: "custom", from: "2025-05-01", to: null });
    assert.equal(seeded.rounds, "rookie");
  });

  test("seeds superflex off the slots, so a 1QB league writes the other bound", () => {
    // The board a two-QB league belongs to is the one thing this shortcut used
    // to leave pointing at whatever was there before. It writes the *predicate*
    // `isSuperflexLineup` asks — more than one QB-eligible slot — rather than the
    // exact count, so the seed lands on the population, not on one lineup.
    const seeded = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"] }),
    );
    assert.deepEqual(seeded.leagueRules.slots, [{ key: "QB+SF", op: "lte", value: 1 }]);
  });

  test("an unsynced lineup writes no slot rule at all", () => {
    // Null and zero are different answers, the rule the whole filter package is
    // built on: an unknown lineup is not evidence of a 1QB league, and a
    // `qb+sf <= 1` on it would seed a board this league may not belong to.
    const seeded = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ roster_positions: null }),
    );
    assert.deepEqual(seeded.leagueRules.slots, []);
  });

  test("each scoring bucket is the bounds the endpoint groups by", () => {
    const scoringOf = (rec: number | null) =>
      seedFromLeague(
        defaultAdpControls(SEASON),
        league({ scoring_settings: rec === null ? null : { rec } }),
      ).leagueRules.scoring;
    assert.deepEqual(scoringOf(1), [{ key: "rec", op: "gte", value: 1 }]);
    assert.deepEqual(scoringOf(0.5), [
      { key: "rec", op: "gte", value: 0.5 },
      { key: "rec", op: "lt", value: 1 },
    ]);
    // Standard is a bound rather than `rec = 0`, because Sleeper omits the key
    // entirely for a league that pays nothing — so the bound catches both
    // spellings, and the quarter-point leagues between them.
    assert.deepEqual(scoringOf(0), [{ key: "rec", op: "lt", value: 0.5 }]);
    assert.deepEqual(scoringOf(null), [{ key: "rec", op: "lt", value: 0.5 }]);
  });

  test("a league Sleeper omits `type` for reads as redraft, lineup", () => {
    const seeded = seedFromLeague(defaultAdpControls(SEASON), league({ settings: {} }));
    assert.equal(seeded.boards, "redraft");
    assert.equal(seeded.leagueRules.bestBall, "no");
  });

  test("a keeper league reads the redraft board, the server's own bucketing", () => {
    const seeded = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ settings: { type: 1 } }),
    );
    assert.equal(seeded.boards, "redraft");
  });

  test("a league with no stored settings seeds without throwing", () => {
    // `settings` is nullable on the payload — a league the crawler stored before
    // it read the blob — and this is the one shortcut that reaches into it.
    // Every setting it can't read falls back the way an omitted field does.
    const seeded = seedFromLeague(defaultAdpControls(SEASON), league({ settings: null }));
    assert.equal(seeded.boards, "redraft");
    assert.equal(seeded.leagueRules.bestBall, "no");
    assert.deepEqual(seeded.leagueRules.slots, [], "an unknown lineup writes no rule");
    assert.deepEqual(
      seeded.leagueRules.scoring,
      [{ key: "rec", op: "lt", value: 0.5 }],
      "and an unknown rate is standard scoring",
    );
    assert.deepEqual(seeded.leagueRules.settings, [{ key: "teams", op: "eq", value: 12 }]);
  });

  test("a type Sleeper wrote as a string is not read as dynasty", () => {
    // The client's own half of the regex-guard rule: only a real number is a
    // type, so a junk value reads as redraft rather than as whatever it coerces
    // to. `"2"` would be dynasty under a loose comparison.
    const seeded = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ settings: { type: "2" } }),
    );
    assert.equal(seeded.boards, "redraft");
  });

  test("seeding twice from one league is the same board", () => {
    // It *replaces* the three rule lists rather than appending to them, so
    // pressing the shortcut again can't accumulate a different answer — and a
    // rule left over from a previous seed can't quietly narrow the new one.
    const once = seedFromLeague(defaultAdpControls(SEASON), league({ total_rosters: 10 }));
    assert.deepEqual(seedFromLeague(once, league({ total_rosters: 10 })), once);
  });

  test("a second seed replaces the first league's rules rather than adding to them", () => {
    const first = seedFromLeague(
      defaultAdpControls(SEASON),
      league({ total_rosters: 10, roster_positions: ["QB", "SUPER_FLEX", "BN"] }),
    );
    const second = seedFromLeague(
      first,
      league({ total_rosters: 14, roster_positions: ["QB", "RB", "BN"] }),
    );
    assert.deepEqual(second.leagueRules.settings, [{ key: "teams", op: "eq", value: 14 }]);
    assert.deepEqual(second.leagueRules.slots, [{ key: "QB+SF", op: "lte", value: 1 }]);
  });
});

describe("rangeBounds", () => {
  test("the relative presets count back from today and end open", () => {
    // Open-ended on purpose: a draft in progress can carry a start time hours
    // ahead, and "last 30 days" shouldn't drop it.
    assert.deepEqual(rangeBounds({ preset: "30d", from: null, to: null }, TODAY), {
      from: "2026-07-01",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "90d", from: null, to: null }, TODAY), {
      from: "2026-05-02",
      to: null,
    });
    assert.deepEqual(rangeBounds({ preset: "12m", from: null, to: null }, TODAY), {
      from: "2025-07-31",
      to: null,
    });
  });

  test("months are calendar months, clamped where the day doesn't exist", () => {
    // Backing up 12 months from a leap day, or from the 31st of a month whose
    // counterpart is shorter, must not roll into the next month — that would
    // silently widen the window by a whole month.
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2024-02-29").from, "2023-02-28");
    assert.equal(rangeBounds({ preset: "12m", from: null, to: null }, "2026-03-31").from, "2025-03-31");
  });

  test("day arithmetic crosses months and years", () => {
    assert.equal(rangeBounds({ preset: "30d", from: null, to: null }, "2026-01-15").from, "2025-12-16");
  });

  test("a lookback counts back its own days and ends open", () => {
    // The counter's general case: the same shape as 30d/90d, carrying its
    // count — so "last 45 days" rolls forward with the calendar exactly as the
    // named presets do.
    assert.deepEqual(
      rangeBounds({ preset: "lookback", from: null, to: null, days: 45 }, TODAY),
      { from: "2026-06-16", to: null },
    );
    // Days-less is malformed, and it must read as unbounded rather than as
    // "since today" — the one misreading that would silently narrow the board.
    assert.deepEqual(
      rangeBounds({ preset: "lookback", from: null, to: null }, TODAY),
      { from: null, to: null },
    );
  });

  test("all time bounds nothing; custom passes its own ends through", () => {
    assert.deepEqual(rangeBounds({ preset: "all", from: null, to: null }, TODAY), {
      from: null,
      to: null,
    });
    assert.deepEqual(
      rangeBounds({ preset: "custom", from: "2026-06-01", to: "2026-06-30" }, TODAY),
      { from: "2026-06-01", to: "2026-06-30" },
    );
  });
});

describe("rangeLabel", () => {
  test("a preset keeps its name, so it stays true tomorrow", () => {
    assert.equal(rangeLabel({ preset: "90d", from: null, to: null }), "Last 90 days");
    assert.equal(rangeLabel({ preset: "all", from: null, to: null }), "All time");
  });

  test("a lookback names itself on the presets' own scale", () => {
    // "Last 45 days" beside "Last 30 days" — one scale, so the typed and the
    // pressed spell the same way.
    assert.equal(
      rangeLabel({ preset: "lookback", from: null, to: null, days: 45 }),
      "Last 45 days",
    );
    assert.equal(
      rangeLabel({ preset: "lookback", from: null, to: null, days: 1 }),
      "Last 1 day",
    );
    assert.equal(rangeLabel({ preset: "lookback", from: null, to: null }), "All time");
  });

  test("a custom range spells out the ends it has", () => {
    assert.equal(
      rangeLabel({ preset: "custom", from: "2026-06-01", to: "2026-07-31" }),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeLabel({ preset: "custom", from: "2026-06-01", to: null }), "Since Jun 1, 2026");
    assert.equal(rangeLabel({ preset: "custom", from: null, to: "2026-07-31" }), "Through Jul 31, 2026");
    // Neither end set narrows nothing, so say what it does rather than "Custom".
    assert.equal(rangeLabel({ preset: "custom", from: null, to: null }), "All time");
  });
});

describe("boardLabel", () => {
  const unbounded: AdpRange = { preset: "all", from: null, to: null };

  test("an unbounded window folds into the season rather than sitting beside it", () => {
    // "2026 · All time" would be claiming two contradictory things.
    assert.equal(boardLabel(unbounded, "2026"), "All of 2026");
    assert.equal(boardLabel({ preset: "custom", from: null, to: null }, "2026"), "All of 2026");
  });

  test("a narrowed window is named after its season, because it is half an answer", () => {
    assert.equal(boardLabel({ preset: "30d", from: null, to: null }, "2026"), "2026 · Last 30 days");
    assert.equal(
      boardLabel({ preset: "custom", from: "2026-06-01", to: null }, "2026"),
      "2026 · Since Jun 1, 2026",
    );
  });

  test("the all-seasons board has only the window to name", () => {
    assert.equal(boardLabel(unbounded, "all"), "All time");
    assert.equal(boardLabel({ preset: "90d", from: null, to: null }, "all"), "Last 90 days");
  });
});

describe("ADP_RANGE_PRESETS", () => {
  test("every named preset has a label, and rangeLabel reads it from here", () => {
    // The chip row is gone and this table is what is left of the presets: the
    // *names*. Every value it carries has to be one `rangeLabel` can be asked
    // about, since that lookup is unguarded — a preset value with no row here is
    // a crash rather than a fallback.
    for (const preset of ADP_RANGE_PRESETS) {
      assert.equal(rangeLabel({ preset: preset.value, from: null, to: null }), preset.label);
    }
  });

  test("the two counts the counter stores as named presets are named here", () => {
    // `lookbackRange` writes 30 and 90 into the named presets and every other
    // count into `lookback`. Both spellings have to read back as the same
    // sentence, or one window would have two names depending on how it was set.
    assert.equal(
      rangeLabel({ preset: "lookback", from: null, to: null, days: 30 }),
      rangeLabel({ preset: "30d", from: null, to: null }),
    );
    assert.equal(
      rangeLabel({ preset: "lookback", from: null, to: null, days: 90 }),
      rangeLabel({ preset: "90d", from: null, to: null }),
    );
  });
});

describe("seasonOptions", () => {
  const density = [
    { season: "2024" },
    { season: "2025" },
    { season: "2025" },
    { season: "2026" },
  ];

  test("newest first, with the pooled board last", () => {
    assert.deepEqual(seasonOptions(density, "2026", SEASON), ["2026", "2025", "2024", "all"]);
  });

  test("the current season is offered even before it has been crawled", () => {
    // Every spring it is empty for a few weeks, and it is still the default.
    assert.deepEqual(seasonOptions([{ season: "2025" }], "2025", "2026"), [
      "2026",
      "2025",
      "all",
    ]);
  });

  test("the selected season is never dropped by the cap", () => {
    // A row describing a board it isn't showing is worse than a shorter row.
    const many = ["2022", "2023", "2024", "2025", "2026"].map((season) => ({ season }));
    const options = seasonOptions(many, "2022", SEASON, 3);
    assert.deepEqual(options, ["2026", "2025", "2022", "all"]);
  });

  test("the pooled board is already last, so selecting it adds no chip", () => {
    // `"all"` is not a season and has no place in the ordering — the branch that
    // keeps a selection alive has to skip it or it would displace a real one.
    assert.deepEqual(seasonOptions(density, "all", SEASON), [
      "2026",
      "2025",
      "2024",
      "all",
    ]);
    const many = ["2022", "2023", "2024", "2025", "2026"].map((season) => ({ season }));
    assert.deepEqual(seasonOptions(many, "all", SEASON, 3), ["2026", "2025", "2024", "all"]);
  });

  test("a season crawled but not this one's is still offered", () => {
    // The list is what there are drafts for, not what a calendar says.
    assert.deepEqual(seasonOptions([{ season: "2019" }], "2026", SEASON), [
      "2026",
      "2019",
      "all",
    ]);
  });

  test("no crawled drafts at all still offers this season and the pool", () => {
    // The cold-database state, and every spring for a few weeks.
    assert.deepEqual(seasonOptions([], "2026", SEASON), ["2026", "all"]);
  });
});

describe("rangeSummary", () => {
  test("says the dates a preset's name doesn't", () => {
    // The label stays "Last 90 days"; inside the panel, where the lenses are
    // sitting on those dates, the reader shouldn't have to work them back off
    // the channel.
    assert.equal(rangeSummary({ preset: "90d", from: null, to: null }, TODAY), "since May 2, 2026");
    assert.equal(rangeSummary({ preset: "12m", from: null, to: null }, TODAY), "since Jul 31, 2025");
  });

  test("a bounded range reads as its pair, a half-open one as its end", () => {
    const custom = (from: string | null, to: string | null): AdpRange => ({
      preset: "custom",
      from,
      to,
    });
    assert.equal(
      rangeSummary(custom("2026-06-01", "2026-07-31"), TODAY),
      "Jun 1, 2026 – Jul 31, 2026",
    );
    assert.equal(rangeSummary(custom(null, "2026-07-31"), TODAY), "up to Jul 31, 2026");
  });

  test("an unbounded range has nothing to add", () => {
    // "All time" needs no gloss, and null is what the caller skips rendering.
    assert.equal(rangeSummary({ preset: "all", from: null, to: null }, TODAY), null);
    assert.equal(rangeSummary({ preset: "custom", from: null, to: null }, TODAY), null);
  });
});

describe("todayIso", () => {
  test("formats the local date, not the UTC one", () => {
    // Late evening in a western zone is already tomorrow in UTC; the reader's
    // "last 30 days" should start from the date on their calendar.
    assert.equal(todayIso(new Date(2026, 6, 31, 23, 30)), "2026-07-31");
    assert.equal(todayIso(new Date(2026, 0, 5, 0, 15)), "2026-01-05");
  });
});

describe("adpNarrowingCount", () => {
  test("the default board narrows nothing", () => {
    assert.equal(adpNarrowingCount(defaultAdpControls(SEASON), SEASON), 0);
  });

  test("each filter counts once, and every league rule with them", () => {
    assert.equal(
      adpNarrowingCount(withRules({ type: "2" }), SEASON),
      1,
    );
    // A rule counts as one, the same arithmetic `activeFilterCount` does for the
    // filters' own trigger — eight rules are eight narrowings, and rolling the
    // list up as "1" would understate a selection doing most of the work. That
    // the two triggers count the same way is the point: one dialog behind them.
    assert.equal(
      adpNarrowingCount(
        {
          ...withRules({
            type: "2",
            slots: [{ key: "QB+SF", op: "gte", value: 2 }],
            settings: [{ key: "teams", op: "eq", value: 12 }],
          }),
          rounds: "rookie",
        },
        SEASON,
      ),
      4,
    );
  });

  test("a bounded window counts, an unbounded one doesn't", () => {
    const base = defaultAdpControls(SEASON);
    // A custom range with neither end set narrows nothing — the same reading
    // `isUnboundedRange` gives it, so the diamond stays dark for a window that
    // is "custom" in name only.
    const range = (range: AdpRange) => adpNarrowingCount({ ...base, range }, SEASON);
    assert.equal(range({ preset: "custom", from: null, to: null }), 0);
    assert.equal(range({ preset: "30d", from: null, to: null }), 1);
    assert.equal(range({ preset: "custom", from: "2026-05-01", to: null }), 1);
    // The counter's general case counts like the named presets it sits beside;
    // its days-less spelling bounds nothing and must not light the trigger.
    assert.equal(range({ preset: "lookback", from: null, to: null, days: 45 }), 1);
    assert.equal(range({ preset: "lookback", from: null, to: null }), 0);
  });

  test("the rounds bucket counts against its default, not against 'all'", () => {
    // The board opens on startups, so that is the board everybody else is
    // reading and it must leave the trigger dark; widening to every draft is a
    // real departure from it even though it narrows less.
    const base = defaultAdpControls(SEASON);
    assert.equal(adpNarrowingCount({ ...base, rounds: DEFAULT_ADP_ROUNDS }, SEASON), 0);
    assert.equal(adpNarrowingCount({ ...base, rounds: "all" }, SEASON), 1);
    assert.equal(adpNarrowingCount({ ...base, rounds: "rookie" }, SEASON), 1);
  });

  test("a season other than the default counts", () => {
    // The board's population, and a larger departure from the board everybody
    // else is reading than any filter here — a different season is a different
    // market, not a slice of this one.
    assert.equal(adpNarrowingCount(defaultAdpControls("2024"), SEASON), 1);
    assert.equal(adpNarrowingCount(defaultAdpControls("all"), SEASON), 1);
  });

  test("the value curve is not a narrowing", () => {
    // It converts an ADP into value once averaged, so it moves the Leagues tab's
    // team value and leaves the population the trigger describes untouched.
    assert.equal(
      adpNarrowingCount({ ...defaultAdpControls(SEASON), steepness: 6 }, SEASON),
      0,
    );
  });

  test("the boards selection is not a narrowing either", () => {
    // Which market is drawn is a display choice over an unchanged population —
    // the same standing the steepness has.
    assert.equal(
      adpNarrowingCount({ ...defaultAdpControls(SEASON), boards: "dynasty" }, SEASON),
      0,
    );
  });
});

describe("shownAdpBoards / toggleAdpBoard", () => {
  test("each selection lights the boards it names", () => {
    assert.deepEqual(shownAdpBoards("both"), { redraft: true, dynasty: true });
    assert.deepEqual(shownAdpBoards("redraft"), { redraft: true, dynasty: false });
    assert.deepEqual(shownAdpBoards("dynasty"), { redraft: false, dynasty: true });
  });

  test("toggling flips one board's visibility", () => {
    assert.equal(toggleAdpBoard("both", "redraft"), "dynasty");
    assert.equal(toggleAdpBoard("both", "dynasty"), "redraft");
    assert.equal(toggleAdpBoard("redraft", "dynasty"), "both");
    assert.equal(toggleAdpBoard("dynasty", "redraft"), "both");
  });

  test("the last lit board can't be turned off", () => {
    // A blank list is unrepresentable, so pressing the only lit key is a no-op
    // rather than a guard every caller has to remember.
    assert.equal(toggleAdpBoard("redraft", "redraft"), "redraft");
    assert.equal(toggleAdpBoard("dynasty", "dynasty"), "dynasty");
  });
});

describe("adpBoardRows", () => {
  const row = (
    player_id: string,
    redraft: number | null,
    dynasty: number | null,
    picks = 10,
  ): AdpPlayerPayload => ({
    player_id,
    name: player_id,
    position: null,
    team: null,
    rookie: false,
    redraft:
      redraft === null
        ? null
        : { adp: redraft, min_pick: 1, max_pick: 30, picks, stdev: 2 },
    dynasty:
      dynasty === null
        ? null
        : { adp: dynasty, min_pick: 1, max_pick: 30, picks, stdev: 2 },
    // Nothing here reads a KTC price: these tests are about the ADP ordering.
    ktc: null,
  });

  const ids = (rows: AdpPlayerPayload[]) => rows.map((r) => r.player_id);

  test("a single board keeps only what it can average, in its own order", () => {
    // The fetch's order is fair to both markets, so it matches neither column
    // read alone — a veteran early in redraft and late in dynasty must re-rank
    // when the reader flips boards.
    const players = [
      row("veteran", 5, 40),
      row("rookie", null, 3),
      row("star", 2, 8),
    ];
    assert.deepEqual(ids(adpBoardRows(players, "redraft")), ["star", "veteran"]);
    assert.deepEqual(ids(adpBoardRows(players, "dynasty")), [
      "rookie",
      "star",
      "veteran",
    ]);
  });

  test("both boards keep every row, redraft order first, dynasty-only tail after", () => {
    // Interleaving on numbers from two different markets would rank a rookie's
    // dynasty 3.0 against a veteran's redraft 5.0, which compares nothing.
    const players = [row("rookie", null, 3), row("veteran", 5, 40), row("star", 2, 8)];
    assert.deepEqual(ids(adpBoardRows(players, "both")), [
      "star",
      "veteran",
      "rookie",
    ]);
  });

  test("ties break on the better sample, then the id", () => {
    const players = [row("thin", 4, null, 3), row("deep", 4, null, 20)];
    assert.deepEqual(ids(adpBoardRows(players, "redraft")), ["deep", "thin"]);
  });

  test("the input order is left alone", () => {
    const players = [row("b", 9, null), row("a", 1, null)];
    adpBoardRows(players, "redraft");
    assert.deepEqual(ids(players), ["b", "a"]);
  });

  test("the rows are the payload's own objects, not copies", () => {
    // `AdpBoardRow` is memoised on a player object, so the board re-sorting
    // must hand back the *same* objects or every row re-renders whenever
    // anything above it does — a filter tray opening, the draft count landing.
    // A `map` into fresh objects here would cost nothing visible and silently
    // undo that, which is why the identity is asserted rather than assumed.
    const players = [row("b", 9, null), row("a", 1, null), row("c", 3, 4)];
    for (const shown of ["redraft", "dynasty", "both"] as const) {
      for (const kept of adpBoardRows(players, shown)) {
        assert.ok(
          players.some((p) => p === kept),
          `${shown} returned a copy of ${kept.player_id}`,
        );
      }
    }
  });
});
