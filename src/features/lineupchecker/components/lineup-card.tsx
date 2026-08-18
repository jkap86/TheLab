"use client";

import type { ManagerLeague } from "@/shared/manager";

import { Avatar } from "@/features/shared/ui/avatar";
import { CardLedge, LeagueCard } from "@/features/shared/ui/league-card";
import { MetricColumns } from "@/features/shared/ui/metric-column";

import { LINEUP_METRICS } from "../lineup-metrics";
import { matchupState, opponentLabel } from "../opponent";
import { projectedOutcomes } from "../projected-result";
import type { ProjectedResult } from "../projected-result";
import type { LeagueMatchup } from "../types";

/**
 * One league in the lineup checker's list: which league, who it is playing this
 * week, and what today's lineup is costing there.
 *
 * **It is the leagues list's card** — `features/shared/ui/league-card`, the same
 * slab with the same two plates on its top edge, the same head inset, the same
 * pull-to-the-top-and-cap on expand. It was a glass row before, and the swap is
 * the argument that card was built on applied to this list: a row that is the
 * whole of what one league has to say, four columns deep, is an object rather
 * than a line of a table. The two lists read as one instrument now, which is what
 * a reader crossing between the two tools experiences.
 *
 * **What it puts on the trailing plate is the opponent and how the week is going
 * against them, where the leagues list puts the record**, and that is the whole
 * of the difference between the two cards. The record is what a season-long list
 * is about; who you are playing and whether you are beating them is what a
 * week's list is about. A league playing Sleeper's median takes two results out
 * of a week rather than one, so the plate carries two marks there — see
 * {@link ProjectedMarks}.
 *
 * **The panel opens on this manager's own roster.** `focusRosterId` is the one
 * thing this card knows that the leagues list doesn't: a reader arrives at a
 * league here *because of their own lineup*, so landing on the projected leader's
 * bench — the panel's own default, which is right for someone who arrived at a
 * league — would answer a question nobody asked. Absent where the week isn't
 * stored, which falls back to that default.
 *
 * **Its stat columns are the leagues list's too, aimed the same way.** They were
 * a hand-drawn cell and three inert slots; they are {@link MetricColumns} over
 * {@link LINEUP_METRICS} now, so which metric each slot holds is a fact about the
 * *list* — held above this card and edited from the heading rail — and this card
 * renders numbers and no picker of its own, exactly as the leagues list's card
 * does.
 */
export function LineupCard({
  league,
  week,
  matchup,
  columns,
  expanded,
  onToggle,
}: {
  league: ManagerLeague;
  /** The week the read is for, or null when none is stored — see {@link matchupState}. */
  week: number | null;
  /** This league's matchup, or undefined where the week isn't stored for it. */
  matchup: LeagueMatchup | undefined;
  /** The metric key each stat column shows, shared by every card in the list. */
  columns: string[];
  /** Whether this is the league currently open — one at a time, list-wide. */
  expanded: boolean;
  /** Open this league, or close it if it is the one already open. */
  onToggle: () => void;
}) {
  return (
    <LeagueCard
      leagueId={league.league_id}
      name={league.name}
      status={league.status}
      ledge={<OpponentLedge week={week} matchup={matchup} />}
      columns={
        <MetricColumns
          metrics={LINEUP_METRICS}
          // Null rather than the `undefined` the payload's league map answers
          // with: "not stored for this league" is an answer the catalogue spells,
          // and a context is not a lookup.
          ctx={{ matchup: matchup ?? null }}
          columns={columns}
        />
      }
      focusRosterId={matchup?.roster_id}
      // Which turns the panel into the game itself: this manager's roster beside
      // the one it is playing, in place of the standings. Undefined on a bye or
      // an unsynced week, which falls back to the standings — there is no game
      // to draw, and the league is the more useful thing to show instead.
      opponentRosterId={matchup?.opponent?.roster_id}
      // The panel opens on this week rather than on the rest of the season,
      // which is the whole reason this tool draws the card at all: a reader here
      // is setting one lineup, so the number beside each player is what he
      // projects for it.
      week={week}
      expanded={expanded}
      onToggle={onToggle}
    />
  );
}

/**
 * Who this league is playing, on the plate holding the card's trailing corner.
 *
 * **It is always drawn, which is where it parts company with the leagues list's
 * record ledge.** That one renders no plate when there is neither a record nor a
 * standing, because a league this manager holds no roster in has nothing to
 * report and an empty housing would be the card saying so. Here "nothing" is
 * itself the answer the card exists to give: a bye, a week the crawler has not
 * reached, a season with nothing stored ahead of today. Each of those is a
 * different fact, and {@link matchupState} is shaped to keep them apart — so the
 * plate names which, rather than three kinds of nothing collapsing into one
 * absent plate and a reader concluding their league has no game when what it has
 * is no data.
 *
 * The three of them wear the same `.lab-readout` cut the record does, dimmed: a
 * cut into the plate's lit face is what makes the plate a housing rather than a
 * label, and the state is a readout either way. An opponent gets the avatar and
 * the name instead, which is a subject rather than a reading.
 *
 * The name is the Sleeper username, and the team name is demoted to the hover —
 * the standings' own rule. This list spans a manager's whole portfolio, so the
 * same opponent turns up in several leagues, and a team name is a nickname
 * someone picked for one of them and changes at will.
 *
 * **The verdict rides the trailing end of the plate, after whichever of those
 * five things the ledge is saying** — see {@link ProjectedMarks}. It is drawn on
 * the "nothing" states too, and that is not an oversight: a league playing
 * Sleeper's median gives its manager a result against the field whether or not
 * anybody was scheduled to play them, so a bye there is a bye *and* a game.
 */
function OpponentLedge({
  week,
  matchup,
}: {
  week: number | null;
  matchup: LeagueMatchup | undefined;
}) {
  const state = matchupState(week, matchup);
  // Off the matchup rather than the state, because the two answer different
  // questions: `matchupState` says who is being played, and this says how the
  // week is going — which a median league answers on a bye.
  const results = projectedOutcomes(matchup);

  if (state.kind === "opponent") {
    const label = opponentLabel(state.opponent);
    return (
      <CardLedge>
        {/* `vs` rather than nothing: the plate opposite a league's name could
            otherwise be read as a second name for the league itself, which is
            the exact confusion the record ledge avoids by being digits. */}
        <span
          aria-hidden="true"
          className="shrink-0 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-foreground/40"
        >
          vs
        </span>
        <Avatar url={state.opponent.avatar_url} name={label} size="sm" />
        <span
          title={state.opponent.team_name ?? undefined}
          className="min-w-0 truncate text-[0.78125rem] font-semibold leading-4 text-foreground/85"
        >
          <span className="sr-only">Playing </span>
          {label}
        </span>
        <ProjectedMarks results={results} opponent={label} />
      </CardLedge>
    );
  }

  const note =
    state.kind === "bye"
      ? "Bye"
      : state.kind === "no-week"
        ? "No week scheduled"
        : "Not synced yet";

  return (
    <CardLedge>
      {/* `min-w-0 truncate` rather than `shrink-0`: the plate is capped at a
          share of the edge (see {@link CardLedge}), so a note wider than that
          share has to give — and a readout hanging past its own housing is what
          the cap exists to prevent. None of the three reaches the cap at 390px;
          this is what happens if one ever does. */}
      <span className="lab-readout min-w-0 truncate rounded px-1.5 py-px text-[0.6875rem] font-semibold uppercase leading-4 tracking-[0.06em] text-foreground/45">
        {note}
      </span>
      <ProjectedMarks results={results} opponent={null} />
    </CardLedge>
  );
}

/** What each mark says, on the hover and to a screen reader. */
const OUTCOME_WORD = { W: "winning", L: "losing", T: "tied" } as const;

/**
 * How the tone reads. The accent is a win, because a lit part is what this app
 * says for *on* everywhere else and a verdict is exactly the thing on this row
 * worth finding at a glance down a hundred cards. A loss is dim rather than
 * amber: amber is the needs-attention tone and it is already spent, one column
 * over, on the shortfall — which is the number here a reader can actually act
 * on. A projected loss against a lineup that is already the best available is
 * not something to do, and two alarms on one row is neither of them.
 */
const OUTCOME_TONE = {
  W: "text-active",
  L: "text-foreground/40",
  T: "text-foreground/70",
} as const;

/**
 * How this league's week is projected to come out — one mark against the
 * scheduled opponent, and a second against the league median where the league
 * plays one.
 *
 * **Two marks rather than one, and never one mark holding both letters.** A
 * median league's week is two games rather than one game with a footnote: the
 * plate above the list counts them apart (see {@link projectedRecord}), and the
 * pair has to read the same way — `W L` as two housings is a win and a loss,
 * where `W L` inside one is a two-character reading of something nobody can
 * name. It is also what lets each carry its own tone, which is the whole of how
 * the pair is scanned.
 *
 * **Which is which is the seat, not a label.** There is no room on this plate to
 * write *opponent* and *median*, so the order is the answer — the head-to-head
 * always leads, exactly as it sits beside the opponent it is a result against —
 * and the hover and the `sr-only` carry the sentence for the two readings that
 * have no seat to read.
 *
 * **`shrink-0` and a fixed width per mark.** The plate does not shrink and its
 * contents have to fit the cap (see {@link CardLedge}), so the part that gives
 * is the opponent's name, which truncates — a verdict that truncated would be a
 * `W` and an `L` reading identically. The width is fixed rather than intrinsic
 * so the marks line up down the list where a card carries two and its neighbour
 * one.
 */
function ProjectedMarks({
  results,
  opponent,
}: {
  results: readonly ProjectedResult[];
  /** The opponent's name for the hover, or null where the ledge names none. */
  opponent: string | null;
}) {
  if (results.length === 0) return null;

  return (
    // A group rather than marks loose in the ledge: `gap-1` between the two is
    // tighter than the plate's own `gap-2`, so a pair reads as one verdict in
    // two parts rather than as two more things on the edge.
    <span className="flex shrink-0 items-center gap-1">
      {results.map(({ against, outcome }) => {
        const bar =
          against === "median"
            ? "the league median"
            : (opponent ?? "this week's opponent");
        const label = `Projected ${OUTCOME_WORD[outcome]} against ${bar}`;
        return (
          <span
            key={against}
            title={label}
            // `py-px` and `leading-4` are the note's own, so a bye's readout
            // and a median mark beside it are one height rather than two
            // housings on one plate — see {@link OpponentLedge}. The width is
            // a box rather than the note's padding, since what has to line up
            // down the list is the letter and not its inset.
            className={`lab-readout w-[1.125rem] rounded py-px text-center text-[0.6875rem] font-semibold leading-4 ${OUTCOME_TONE[outcome]}`}
          >
            <span className="sr-only">{label}</span>
            <span aria-hidden="true">{outcome}</span>
          </span>
        );
      })}
    </span>
  );
}
