import { NextResponse } from "next/server";

import type { LeagueWeekPayload, LeagueWeekViewPayload } from "@/shared/contract";
import { LAST_REGULAR_WEEK } from "@/shared/projections";
import { integer } from "@/shared/query";
import { readLeagueWeekView } from "@/shared/stats";
import type { LeagueWeekView } from "@/shared/stats";

import { resolveLeagueRequest } from "../league-request";
import { readResponse } from "../../../read-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One league read as a single week: each rostered player's projection and points
 * per game, each team's current-versus-optimal lineup, and the week's NFL games.
 *
 * **Only the lineup checker asks for it**, which used to be expressed as an
 * absent `?week=` on the core payload and is now expressed by simply not making
 * this request. That is a better spelling of the same rule: "not asked for" and
 * "asked for and unanswerable" were two states one optional field had to carry,
 * and they are a missing request and a failure status now — two states nothing
 * has to reconstruct, which is what the second half of this note is about.
 *
 * It is the most expensive of the three enrichments — ~420–520ms against the
 * core's ~53ms on a seeded corpus — and it is the one whose panel a reader is
 * most likely to open repeatedly, so keeping it off the first paint is worth
 * most here. Keyed on the week alone (never the board), so stepping a week
 * re-runs this and nothing else, and re-tuning the ADP drawer never re-runs it.
 *
 * **On the server it is coalesced rather than cached the way its siblings are**
 * ({@link readLeagueWeekView}), because this is the panel's one *live* read.
 * Callers arriving while a read is running share it, which costs no freshness at
 * all — they asked before the answer existed. What they may then keep is bounded
 * three ways over: the key carries every team's actual starters, so a lineup
 * change is a key nothing has answered; the entry is cut short at the next
 * kickoff, since that is the minute seats lock; and a minute is the ceiling over
 * both — deliberately shorter than the browser's own window rather than longer,
 * which is the opposite of every other cache in this app and the whole reason
 * `shared/stats/read-cache` argues about it at length.
 *
 * **A failure costs the columns rather than the league, and it is still a
 * failure.** That first half is the judgement this read has always had — these
 * are two columns on top of a panel whose point is the rosters — and it is held
 * up on the *client*, where the week is a query of its own and only the core's
 * error is the panel's error. What it is not is a reason to answer `200 null`:
 * {@link getLeagueWeekView} returns `Promise<LeagueWeekView>`, so there is no
 * such thing as a week with nothing to say, and a null body here could only ever
 * have meant "this read threw". Dressed as a success it was cached as one for
 * the entry's whole stale time and never retried — see {@link readResponse},
 * which is where the two failure statuses are chosen.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
) {
  const resolved = await resolveLeagueRequest(request, context.params);
  if (!resolved.ok) return resolved.response;
  const { leagueId, detail, searchParams } = resolved;

  const week = integer(searchParams, "week", {
    min: 1,
    max: LAST_REGULAR_WEEK,
    fallback: null,
  });
  if (!week.ok) return NextResponse.json({ error: week.error }, { status: 400 });
  if (week.value === null) {
    // A route whose whole subject is a week has nothing to answer without one,
    // and defaulting to "this week" would make a caller that forgot the
    // parameter look like it worked.
    return NextResponse.json({ error: "week is required" }, { status: 400 });
  }
  // Hoisted out of the result object so the narrowing survives into the closure
  // below — a property read there is `number | null` again however it was
  // checked, and a cast would be the same fact asserted rather than proved.
  const asked = week.value;

  return readResponse({
    label: "league.week",
    subject: `league=${leagueId} week=${asked}`,
    failure: "Failed to read this week",
    // Serialised *inside* the read, so the `Map` conversion is covered by the
    // same failure branch the query is: a payload this route could not build is
    // no more of an answer than one it could not fetch. The contract type is
    // annotated here rather than on the call, on the value that crosses.
    read: async (): Promise<LeagueWeekPayload> =>
      serializeWeekView(
        await readLeagueWeekView({
          leagueId,
          season: detail.season,
          week: asked,
          teams: detail.teams,
          rosterPositions: detail.roster_positions,
          scoringSettings: detail.scoring_settings,
          bestBall: detail.best_ball,
          medianMatch: detail.median_match,
        }),
      ),
  });
}

/**
 * The week view's `Map`s as JSON objects.
 *
 * Maps are the right shape in the domain — the keys are ids and the lookups are
 * per row — and they serialise to `{}`, so the conversion has to be explicit.
 * Roster ids are numbers there and become strings here, which is what JSON keys
 * are; the client indexes with a template string rather than pretending
 * otherwise.
 *
 * `ppg_source.weeks` crosses as a **count** rather than the list: what a reader
 * needs is how much the average is out of, and each row already carries its own
 * `games` for the case that actually varies (a player who missed two of them).
 *
 * It takes the view rather than `view | null`, which is the compiler's half of
 * the rule above: there is no week this route answers with nothing, so a null
 * branch here would be a place for a failure to become a body again.
 */
function serializeWeekView(view: LeagueWeekView): LeagueWeekPayload {
  const projection: Record<string, number> = {};
  for (const [id, points] of view.projection) projection[id] = points;

  const ppg: Record<string, { average: number; games: number }> = {};
  for (const [id, reading] of view.ppg) {
    ppg[id] = { average: reading.average, games: reading.games };
  }

  const team_projection: LeagueWeekViewPayload["team_projection"] = {};
  for (const [rosterId, lineup] of view.team_projection) {
    // Structurally the payload's own shape already — the lineup's points were
    // dropped upstream, where the reason belongs — so this is the key conversion
    // and nothing else.
    team_projection[String(rosterId)] = lineup;
  }

  const team_ppg: LeagueWeekViewPayload["team_ppg"] = {};
  for (const [rosterId, reading] of view.team_ppg) {
    team_ppg[String(rosterId)] = {
      average: reading.average,
      games: reading.games,
    };
  }

  // Already the payload's own shape — the domain type *is* the wire type here —
  // so this is the `Map` → object conversion and nothing else. Every team the
  // schedule named crosses, not only the ones these rosters hold: a team absent
  // from a non-empty map is what says "bye", so trimming it to the rosters would
  // make every unrostered club read as one.
  const games: LeagueWeekViewPayload["games"] = {};
  for (const [team, game] of view.games) games[team] = game;

  return {
    week: view.week,
    // Already the payload's own shape, and null passes straight through: a
    // league that plays no median has no bar rather than a bar of nothing.
    median: view.median,
    ppg_source: {
      season: view.ppg_source.season,
      weeks: view.ppg_source.weeks.length,
      prior: view.ppg_source.prior,
    },
    projection,
    ppg,
    team_projection,
    team_ppg,
    games,
  };
}
