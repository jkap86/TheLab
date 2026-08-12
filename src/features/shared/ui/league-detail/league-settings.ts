import {
  BEST_BALL_OPTIONS,
  COMMON_SCORING_KEYS,
  NON_SETTING_KEYS,
  SETTING_KEYS,
  SETTING_KEY_BY_KEY,
  TEAMS_KEY,
  TYPE_OPTIONS,
  settingKeyLabel,
} from "../../league-filters/defaults.ts";
import { rankKeys, scoringKeyLabel } from "../../league-filters/options.ts";
import { leagueType } from "../../league-filters/predicates.ts";
import { formatRuleValue } from "../../league-filters/summaries.ts";

/**
 * What a league is configured as, as two lists of rows the Settings tab prints.
 *
 * Pure and tested for the reason its neighbours in this folder are: every rule
 * below is a reading of a Sleeper blob, and each of them is silent when wrong —
 * a row saying `trade deadline 99` or `type 2` renders perfectly well and tells
 * a reader nothing, and a scoring list that keeps its stored zeros makes two
 * leagues with identical scoring look like different leagues.
 *
 * **It names nothing itself.** Every label, ranking and value name here comes
 * from `league-filters`, which is the vocabulary the filter dialog already
 * writes rules in — so the word a reader narrows on ("Dynasty", "No deadline",
 * "Trade deadline") is the word this panel prints back at them. A second table
 * would be a second chance to call `type: 2` something else. The imports are
 * relative with an explicit `.ts` extension, the mechanism this folder's other
 * pure modules and their tests already use.
 */

/** One line of a settings column: what it is called, and what it says. */
export type SettingRow = {
  /** Stable within its column — the React key, and what a test names a row by. */
  key: string;
  label: string;
  /** The value as a reader reads it — a name wherever the number has one. */
  value: string;
  /** What the key covers, for the row's hover; absent for a key nothing names. */
  title?: string;
};

/**
 * The `settings` keys this list states in words at its head rather than leaving
 * to the generic run below, with the names the filter dialog's own rails use.
 *
 * Derived from those rails rather than retyped: `TYPE_OPTIONS` carries `"all"`
 * and a stringified code per type, which is a control's vocabulary, and what a
 * row needs is the number Sleeper stores against the same word. Deriving is what
 * keeps one spelling of "Dynasty" in the app.
 *
 * Best ball is here for completeness of the *set* and is not read: the payload
 * carries the app's one answer to that question (`BEST_BALL_SQL` at the other
 * end of the wire), so the row is built from that rather than from the blob —
 * see {@link leagueSettingRows}.
 */
const NAMED_SETTING_VALUES: Record<string, Map<number, string>> = {
  type: new Map(
    TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => [
      Number(option.value),
      option.label,
    ]),
  ),
  best_ball: new Map([
    [0, BEST_BALL_OPTIONS.find((o) => o.value === "no")?.label ?? "Lineup"],
    [1, BEST_BALL_OPTIONS.find((o) => o.value === "yes")?.label ?? "Best ball"],
  ]),
};

/**
 * What this league pays for, richest-first by the menu's own ranking.
 *
 * **A stored zero is dropped, and that is a reading rather than a tidy-up.**
 * `scoringValue`'s rule is that a key absent from a stored blob is 0 — which is
 * exactly why `bonus_rec_te > 0` is how TE premium is asked — so a league that
 * omits `rec` and one that stores `rec: 0` are the same league, and a list that
 * drew them differently would be reporting a fact about Sleeper's serialisation
 * rather than about the league. Keeping them costs the reading twice over: the
 * blob carries ~60 keys and most of a season's leagues zero most of them, so the
 * column a reader opened to see half PPR would be forty rows of nothing first.
 *
 * Negative rates stay, since paying −2 for an interception is something a league
 * does. Non-numeric values are dropped for the reason the rule menu drops them:
 * this build has no reading for one, and `[object Object]` in a settings list is
 * worse than a row that isn't there.
 */
export function leagueScoringRows(
  scoring: Record<string, number> | null,
): SettingRow[] {
  if (!scoring) return [];

  const scored = Object.entries(scoring)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([key]) => key);

  return rankKeys(scored, COMMON_SCORING_KEYS).map((key) => ({
    key,
    label: scoringKeyLabel(key),
    value: formatRuleValue(scoring[key]),
  }));
}

/**
 * How this league is configured: the three facts that say what game it is,
 * then everything else it has set.
 *
 * The three that lead are the ones a bare walk of the blob answers badly.
 * **Teams is not in the blob at all** — it is `total_rosters` on the league row,
 * which is why `SETTING_KEYS` carries it as its own entry, and the panel counts
 * the rosters it already holds rather than asking for a column. **Type and
 * format are digits**: `type: 2` and `best_ball: 1` are a filter's vocabulary,
 * not a reader's, so they are named from the rails that offer them and the
 * generic run skips exactly those two ({@link NON_SETTING_KEYS}, the same set
 * for the same shape of reason). And the format is read off `bestBall` rather
 * than off the blob, because that boolean is the app's one answer to the
 * question — a panel disagreeing with the board about what best ball is would be
 * the drift `BEST_BALL_SQL` is shared to prevent.
 *
 * Everything after them is whatever the league stores, in `SETTING_KEYS`' order
 * with the keys it doesn't rank after them — so a house setting this build has
 * never heard of is still printed, spelled with its underscores opened out,
 * rather than being silently dropped for not being on a list.
 */
export function leagueSettingRows(league: {
  settings: Record<string, unknown> | null;
  /** How many rosters the league holds — `teams.length` off the payload. */
  teams: number;
  /** Whether Sleeper seats the lineups, as the payload reports it. */
  bestBall: boolean;
}): SettingRow[] {
  const { settings, teams, bestBall } = league;

  const named = (key: string, value: number): string =>
    NAMED_SETTING_VALUES[key]?.get(value) ?? formatRuleValue(value);

  const lead: SettingRow[] = [
    // A 0 is a league this app stored before Sleeper answered rather than a
    // league with no teams — `settingValue`'s own rule for this key — so it is
    // left out rather than printed as a size.
    ...(teams > 0 ? [row(TEAMS_KEY, String(teams))] : []),
    row("type", named("type", leagueType({ settings }))),
    row("best_ball", named("best_ball", bestBall ? 1 : 0)),
  ];

  const stored = new Map<string, number>();
  for (const [key, value] of Object.entries(settings ?? {})) {
    if (typeof value === "number" && !NON_SETTING_KEYS.has(key)) {
      stored.set(key, value);
    }
  }

  const ranked = rankKeys(
    [...stored.keys()],
    SETTING_KEYS.map((setting) => setting.key),
  ).flatMap((key) => {
    const value = stored.get(key);
    // Unreachable — the keys came out of this map — and spelled as a skip
    // rather than an assertion, which is what keeps the value a number without
    // telling the compiler something it can't check.
    return value === undefined ? [] : [row(key, settingValueText(key, value))];
  });

  return [...lead, ...ranked];
}

/**
 * A key's label and hint, from the one table that names them.
 *
 * The label falls back to the key with its underscores opened out
 * ({@link settingKeyLabel}) and the hint to nothing at all, which is the honest
 * pair for a setting this build has never met: a made-up description would be a
 * guess presented as documentation.
 */
function row(key: string, value: string): SettingRow {
  return {
    key,
    label: LEAD_LABELS[key] ?? settingKeyLabel(key),
    value,
    title: SETTING_KEY_BY_KEY.get(key)?.hint,
  };
}

/**
 * The two keys the naming table deliberately has no entry for.
 *
 * `SETTING_KEYS` leaves `type` and `best_ball` out on purpose — they are rails
 * in the dialog rather than rules — so `settingKeyLabel` would spell them
 * "type" and "best ball". "Format" rather than "Best ball" for the second,
 * because the row's *value* is what says which format it is and a row reading
 * "Best ball: Lineup" is a label arguing with its own answer.
 */
const LEAD_LABELS: Record<string, string> = {
  type: "Type",
  best_ball: "Format",
};

/**
 * One stored number as a reader reads it: a name where the key gives its numbers
 * names, the sentinel's name where it is the sentinel, and the number itself
 * otherwise.
 *
 * The sentinel is the row this exists for. Sleeper spells "no trade deadline" as
 * `trade_deadline: 99`, which as a week is a lie the same way it is a lie in a
 * filter — the reason `settingValue` reads it as null for comparison and the
 * dialog reaches it by name. A settings *list* has no comparison to protect, so
 * it needs only the name, and it reads it from the same table.
 */
function settingValueText(key: string, value: number): string {
  const spec = SETTING_KEY_BY_KEY.get(key);
  if (spec?.sentinel && spec.sentinel.value === value) return spec.sentinel.label;
  const label = spec?.values?.find((option) => option.value === value)?.label;
  return label ?? formatRuleValue(value);
}
