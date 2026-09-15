/**
 * Why the app is showing the wrong NFL week — the whole chain, read-only.
 *
 * **Every link in this chain answers `1` when it cannot answer at all**, which
 * is why a diagnostic exists rather than a log grep. `currentWeek` resolves the
 * week a page shows when the caller named none, and it falls back to week 1 in
 * three unrelated cases:
 *
 *   - Sleeper's `state/nfl` read *failed* — a timeout, a 5xx, a shed permit, a
 *     spent request budget. Caught, folded to null, answered 1.
 *   - Sleeper answered a **null body**. Same fold, same 1.
 *   - The state's season is not the page's and is not *older* than it. Same 1.
 *
 * In week 1 all three are invisible, because 1 is also the true answer. From
 * week 2 on every one of them renders as "the app is stuck on week 1", with
 * nothing on the page and nothing in the payload able to tell you which — the
 * page says `Week 1` exactly as confidently as it would if Sleeper had said so.
 *
 * A fourth cause was the *field*: the resolver preferred Sleeper's
 * `display_week`, which lags the roll-over by a day, so a Tuesday in week 2
 * rendered as a perfectly trustworthy `Week 1`. It reads `leg` now — stage 1
 * prints all three so the difference stays visible, and a run whose verdict is
 * "this is what Sleeper publishes" is now a claim about `leg`.
 *
 * So this walks the chain and names the link that decided:
 *
 *   1. the raw state — what Sleeper actually publishes right now
 *   2. the season — what the app resolved, and whether it matches the state's
 *   3. the resolution — what `currentWeek` answers, and **which branch** it took
 *   4. the scoreboard — whether the resolved week's games are already over
 *
 * **It never writes** and it needs no database: the week chain is Sleeper and
 * arithmetic, so this is safe to point at production and runs anywhere the
 * network can reach Sleeper.
 *
 *   npm run week:doctor
 *
 * `--season=2026` pins the page's season the way `?season=` does, for checking
 * what a historical page resolves.
 */
import { getActiveSeason } from "@/shared/season";
import {
  getNflState,
  lastGoodNflState,
  sleeperGet,
  sleeperUrl,
  withBackgroundSleeper,
} from "@/shared/sleeper";
import { getWeekGameClocks, phaseCounts } from "@/shared/schedule";
// Deep-imported rather than taken from `@/shared/projections`, which is
// server-only: its barrel reaches `ros-read` and so `@/shared/db`, and this
// doctor deliberately needs no database. `weeks.ts` has no runtime imports at
// all, which is the property that rule exists to protect.
import {
  currentWeek,
  LAST_REGULAR_WEEK,
  restOfSeasonStart,
  stateWeek,
} from "@/shared/projections/weeks";
import type { SleeperNflState } from "@/shared/sleeper";

const argv = process.argv.slice(2);
const pinnedSeason = argv
  .find((a: string) => a.startsWith("--season="))
  ?.slice("--season=".length);

const say = (line = "") => console.log(line);
const head = (n: number, title: string) => {
  say();
  say(`── ${n}. ${title}`);
};

/**
 * Which branch of `currentWeek` a given state takes, re-derived here rather
 * than instrumented into the module — the point of a read-only doctor is that
 * it changes nothing it is diagnosing, and this rule is four lines.
 *
 * Kept textually beside `projections/weeks.ts`' own branches; a divergence
 * would be a doctor confidently naming the wrong cause, so the assertions this
 * makes are about the *state*, not about the function's return.
 */
function branchOf(
  state: SleeperNflState | null,
  season: string,
): { week: number | null; why: string; trusted: boolean } {
  if (!state) {
    return {
      week: 1,
      why: "the state read answered nothing — FELL BACK to week 1",
      trusted: false,
    };
  }
  if (state.season === season) {
    const field = typeof state.leg === "number" ? "leg" : "week";
    const raw = stateWeek(state);
    return {
      week: Math.min(Math.max(Math.trunc(raw), 1), LAST_REGULAR_WEEK),
      why:
        `Sleeper said so — took \`${field}\` = ${raw} ` +
        `(leg=${state.leg}, week=${state.week}, display_week=${state.display_week})`,
      trusted: true,
    };
  }
  const requested = Number(season);
  const current = Number(state.season);
  if (Number.isFinite(requested) && Number.isFinite(current) && requested < current) {
    return {
      week: null,
      why: `the page's season (${season}) is older than Sleeper's (${state.season}) — no week left`,
      trusted: true,
    };
  }
  return {
    week: 1,
    why:
      `the page's season (${season}) is not Sleeper's (${state.season}) and is not older ` +
      `— FELL BACK to week 1`,
    trusted: false,
  };
}

async function main(): Promise<void> {
  say("The NFL week, end to end. Read-only; no database needed.");
  say(`Now: ${new Date().toISOString()}`);

  head(1, "The raw state — GET /v1/state/nfl");
  // Read past the process-wide hold, so this says what Sleeper publishes *now*
  // rather than what the app is willing to serve on its behalf. The two are the
  // same on a healthy process and the difference is the whole diagnosis on a
  // sick one, so stage 1 asks Sleeper and stage 3 asks the app.
  let state: SleeperNflState | null = null;
  let stateError: unknown = null;
  try {
    state = await withBackgroundSleeper(() =>
      sleeperGet<SleeperNflState | null>(sleeperUrl("state", "nfl"), null),
    );
  } catch (error) {
    stateError = error;
  }

  if (stateError) {
    say(`   UNREACHABLE — ${(stateError as Error).message ?? stateError}`);
    say("   This is the failure that renders as week 1. The read threw, so");
    say("   `currentWeek` caught it and answered 1 without saying so.");
  } else if (!state) {
    say("   NULL BODY — Sleeper answered, with nothing in it.");
    say("   Folded to null, and so to week 1, indistinguishably.");
  } else {
    say(`   season          ${state.season}`);
    say(`   season_type     ${state.season_type}`);
    say(`   week            ${state.week}   (week of \`season_type\`)`);
    say(`   leg             ${state.leg}   <- what a page shows`);
    say(`   display_week    ${state.display_week}   (Sleeper's UI hint — not read)`);
    if (state.leg !== state.display_week) {
      say("   NOTE — `leg` and `display_week` disagree. That is the ordinary");
      say("   Tuesday state: Sleeper rolls `leg` first. The app reads `leg`.");
    }
    say(`   season_start    ${state.season_start_date ?? "(absent)"}`);
  }

  const served = await getNflState().catch(() => null);
  const holdingStale =
    !state && served !== null
      ? "   The app is serving the last state it read, rather than week 1."
      : null;
  if (holdingStale) {
    say();
    say(holdingStale);
    say(`   held: season ${served?.season} leg ${served?.leg}`);
  }
  // Past here the chain is judged on what the app can actually get, which is
  // the fresh read where there is one and the held one otherwise.
  state = state ?? served ?? lastGoodNflState();

  head(2, "The season the app resolved");
  const season = pinnedSeason ?? (await getActiveSeason());
  say(`   ${season}${pinnedSeason ? "   (pinned by --season=)" : "   (getActiveSeason)"}`);
  if (state && state.season !== season) {
    say(`   MISMATCH — Sleeper's state says ${state.season}.`);
  }

  head(3, "What `currentWeek` resolves");
  const resolved = await currentWeek(season, getNflState).catch(() => null);
  const branch = branchOf(state, season);
  say(`   week            ${resolved ?? "null (season is over)"}`);
  say(`   because         ${branch.why}`);
  if (!branch.trusted) {
    say();
    say("   *** This is a FALLBACK, not a reading. The page is showing week 1");
    say("   *** because nothing could tell it otherwise.");
  }

  const ros = await restOfSeasonStart(season, getNflState).catch(() => null);
  say(`   rest-of-season starts at week ${ros ?? "null"}   (same field, same clamp)`);
  if (state && resolved !== null && ros !== null && ros !== resolved) {
    say(`   NOTE — the page's week (${resolved}) and the ROS span's start (${ros}) disagree.`);
    say("   They read one field through one clamp, so this means the state");
    say("   moved between the two reads — re-run to confirm it settles.");
  }

  head(4, "The scoreboard — is the shown week already over?");
  if (resolved === null) {
    say("   No week to check.");
  } else {
    for (const week of [resolved, resolved + 1]) {
      if (week > LAST_REGULAR_WEEK) continue;
      const read = await getWeekGameClocks(season, week).catch(() => null);
      if (!read || !read.ok) {
        say(`   week ${week}: unreadable`);
        continue;
      }
      const counts = phaseCounts(read.clocks);
      const total = counts.pre + counts.live + counts.final;
      const label = week === resolved ? "shown" : "next ";
      say(
        `   week ${week} (${label}): ${total} games — ` +
          `${counts.pre} to come, ${counts.live} live, ${counts.final} final`,
      );
      if (week === resolved && total > 0 && counts.final === total) {
        say("   *** Every game of the week the app is showing has been played.");
        say("   *** Sleeper has not advanced `leg` past it yet.");
      }
    }
  }

  say();
  say("── Verdict");
  if (!branch.trusted) {
    say("   The week is a fallback. Fix the state read, not the week rule.");
  } else if (resolved === null) {
    say("   The season is over; there is no week to show.");
  } else {
    say(`   The app is showing week ${resolved}, which is what Sleeper publishes.`);
    say("   If that is not the week you expect, the disagreement is with");
    say("   Sleeper's `leg`, not with this app's reading of it.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
