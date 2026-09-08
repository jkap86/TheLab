"use client";

import { memo, type MouseEvent } from "react";

import type { LineupCheckLeague, ManagerLeague } from "@/shared/contract";
import {
  CardPlateRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_HOUSING_INSET,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  LeagueConfigWindow,
  LeaguePlate,
  PlateBay,
  PlateDivider,
  rankColor,
  ReadingPlate,
  Scanlines,
  usePanelCap,
} from "@/features/shared";

import {
  gapCell,
  kickoffCell,
  rosterCell,
  superflexCell,
  type MetricCell,
} from "../helpers/lineup-check-metrics";
import {
  formatRecord,
  leagueWeekRecord,
  type LeagueWeekRecord,
} from "../helpers/week-summary";
import { LeagueSyncKey } from "./league-sync-key";
import { WeekPanes } from "./week-panes";

/**
 * One league's week, as an instrument housing that rises toward the viewer.
 *
 * The leagues console's card with a different pair of numbers in it, and
 * deliberately the same object: a reader arriving here from `/manager` is
 * looking at the same leagues, and two cards drawn to hold a league would be
 * two chances for one of them to drift. So it carries the same housing, the
 * same league plate with the avatar lit in its bezel, and the same league
 * config rail — with the week's projected outcome on the plate opposite, where
 * the manager card puts the record and the ranks, and four checks on the tile
 * row where that card puts its ranks.
 *
 * Three constraints are inherited and every one is silent when broken:
 *
 * 1. `transform-style: preserve-3d` cannot coexist with `overflow: hidden`,
 *    which forces a flat rendering context and collapses every child
 *    `translateZ`. So the decorative layers live inside one absolutely
 *    positioned wrapper that does the clipping, and the content stays a direct
 *    child of the summary.
 * 2. The card is `flex-1` inside a `flex` `<li>`, never `h-full` — a percentage
 *    height cannot resolve against an auto-sized grid row.
 * 3. **`group/card` is named**, because the lineup's own disclosure opens a
 *    `group/bench` and an unnamed `group-open:` would have the bench toggling
 *    the card's transform.
 *
 * **`memo`'d for `LeagueCard`'s reason**, which is the one thing the driven
 * disclosure costs: a press is a state change on the page now rather than a
 * native toggle, so without it every league on the account re-renders to move
 * two of them. Every prop is stable but `open` and `lit`, which are the two
 * that are meant to move; `onSynced` is the page's own `useCallback` and
 * `onToggle` takes the id so it need not close over which card is open.
 *
 * Hook-free, like `LeagueCard`: the only interaction it owns is the disclosure.
 * `onSynced` is forwarded to `LeagueSyncKey` and never called here, and the
 * week view's seat pick lives inside `WeekPanes` — which is what keeps that
 * true, and what makes the pick per-card for free: a pick is an index into one
 * lineup and means nothing outside it, so a second league opening must not
 * inherit the first's, and a component mounted per card cannot.
 *
 * **The card wears the metal finish** ({@link CONSOLE_METAL}), which is a set
 * of token overrides on the `<details>` and not a single element of markup:
 * the housing, both plates and every key inside already name the tokens it
 * moves, so the cascade applies it. The grain is a background layer for the
 * same reason the decorative span exists — an overlaid brush would have to be
 * clipped, and a clip is what collapses the depth below.
 *
 * **An open card is the screen**, which is `LeagueCard`'s own arrangement and
 * carries the same three consequences here. The list stands down around it and
 * the page stops scrolling (`useActiveCard`), so nothing is sticky — there is
 * nothing to stick within once the list is one card tall. The disclosure is
 * driven rather than native, because the page has to change with the toggle.
 * And the chrome is lit off `data-lit` rather than `[open]`, because the
 * disclosure stays open for as long as the panel takes to collapse and a card
 * lit off `[open]` would let go only afterwards. That file carries the
 * arguments in full; the two cards are one object seen from two tools and a
 * difference between them here is a drift with nothing on screen saying which
 * page a reader is on.
 *
 * **The expanded half fills the shell and scrolls as one block**, where the
 * manager card's two panes scroll their own lists. That is the arrangement
 * `WeekPanes` already asks for rather than a shortcut: its two lineups are read
 * *across* — a seat row against the seat row opposite, which is why both are
 * measured to the same height at every width — and two independent scrollers
 * are exactly what would put them out of step. One scroller keeps the rows
 * aligned; {@link usePanelCap} is what bounds it.
 *
 * A fourth constraint travels with the card: the depth chrome rides
 * `pointer-fine:`, because one card per league times several composited planes
 * each is what kills an iOS Safari tab when a card opens. `LeagueCard` carries
 * the argument in full; the gate must stay on both, since this page renders the
 * same card over the same league list.
 */

export const LineupCheckCard = memo(function LineupCheckCard({
  league,
  entry,
  onSynced,
  open,
  lit,
  onToggle,
}: {
  league: ManagerLeague;
  /** This league's week, once the check lands. Undefined while it is in flight. */
  entry?: LineupCheckLeague | null;
  /** Re-read this league after its sync key changed something. Forwarded only. */
  onSynced?: (leagueId: string) => void;
  /** Whether the disclosure is open — the page's, not the element's own. */
  open: boolean;
  /** Whether the chrome is lit: open, and not yet collapsing. See the note. */
  lit: boolean;
  /** The press. `useActiveCard` drives the disclosure and the list together. */
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
}) {
  // The card is still hook-free in the sense that matters — it owns no state of
  // its own. This is a measurement of the box below and nothing else; see
  // `usePanelCap`, which is a hook rather than a wrapper component precisely so
  // this half can keep its own inset.
  const {
    ref: panelRef,
    style: panelStyle,
    mounted: panelMounted,
  } = usePanelCap<HTMLDivElement>(open, open && !lit);

  const gap = gapCell(entry);
  const kickoff = kickoffCell(entry);
  const superflex = superflexCell(entry);
  const roster = rosterCell(entry);

  return (
    // `data-card` is how the close finds this row again once the list is back
    // around it — see `useActiveCard`.
    <li
      data-card={league.league_id}
      className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10"
    >
      {/* `min-w-0` is what lets the card shrink to a phone. The `<li>` is a
          row flex container, so its item takes `min-width: auto` and refuses
          to go below its own min-content — and the expanded half's two panes
          sit side by side at every width by design, which puts that
          min-content above 390. Without this the card is wider than the
          viewport and the whole page scrolls sideways. */}
      <details
        open={open}
        data-lit={lit ? "" : undefined}
        className={`group/card ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col`}
      >
        <summary
          onClick={(event) => onToggle(league.league_id, event)}
          className={
            `lab-card-3d ${CONSOLE_CARD_SHELL} pb-[1.125rem] pt-[1.875rem] flex flex-1 cursor-pointer list-none flex-col font-mono ` +
            // **The gutter is 14px below `sm`**, where the card takes 18px from
            // `sm` up. Four tiles across a 362px card is what asks for it — the
            // strip is the card's full width less this inset, and the four
            // labels are the tightest thing on the page. It composes the
            // *shell* rather than appending to `CONSOLE_CARD`, because two base
            // `px-*` utilities are decided by Tailwind's emit order — see that
            // constant's note. The manager card made the same measurement.
            "px-3.5 sm:px-[1.125rem] " +
            "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
            "pointer-fine:hover:[transform:translateZ(30px)_rotateX(0deg)] " +
            "pointer-fine:group-data-[lit]/card:[transform:translateZ(20px)_rotateX(0deg)] " +
            "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
            "hover:border-active/45 group-data-[lit]/card:border-active/45 " +
            "pointer-fine:hover:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "pointer-fine:group-data-[lit]/card:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >
          {/* Everything decorative, in the one layer that clips. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-data-[lit]/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100" />
          </span>

          {/* Outside the clipping layer: the plates straddle the top edge, and
              a clip is exactly what would cut them off. */}
          <CardPlateRow>
            <LeaguePlate name={league.name} avatarUrl={league.avatar_url} />
            <ProjectionPlate entry={entry} />
          </CardPlateRow>

          <CardRule />

          {/* What game this league is playing, where the identity line used to
              be. It is the manager card's own window and the same component,
              so a league described one way there cannot be described another
              here — and the team name went with the line deliberately: the
              card is about the league, and `total_rosters` is now stated once,
              as the rail's own `Teams` field. `18px` sits between the tiles'
              22px and the plates, so the planes read front to back. */}
          <LeagueConfigWindow
            league={league}
            className="mt-3.5 pointer-fine:[transform:translateZ(18px)]"
          />

          {/* A lineup graded off the roster's *live* starters rather than the
              week's own stored ones has to say so — otherwise a stepped week
              shows today's lineup under that week's heading, which is the one
              claim this tool must not make silently. It kept its own line when
              the identity line went, for exactly that reason. */}
          {entry?.as_of === "current" && (
            <p className="relative mt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/85 pointer-fine:[transform:translateZ(14px)]">
              Lineup as set now
            </p>
          )}

          {/* A direct child of the summary, so the `translateZ` survives: a
              plain wrapper here is a flat rendering context and the depth would
              go with no error to say so.

              **Four across at every width, where it was two-up on a phone.**
              What made that possible is the reading splitting in two: a phone
              tile sets the numeral alone and its unit under it, so nothing has
              to fit `2 to move` into ~72px on one line. See `MetricCell`. */}
          <div className="relative mt-2.5 grid grid-cols-4 gap-1.5 sm:gap-2 pointer-fine:[transform:translateZ(22px)]">
            <MetricTile label="Vs optimal" cell={gap} />
            <MetricTile label="Kickoff" cell={kickoff} />
            <MetricTile label="Superflex" cell={superflex} />
            <MetricTile label="Roster" cell={roster} />
          </div>
        </summary>

        {/* Outside the 3D context on purpose: a lineup table inside a
            `preserve-3d` subtree pays for a composited layer per row and gains
            nothing, since none of it is tilted. It is also what makes this
            wrapper's own `overflow: hidden` safe — a clip inside the summary
            would collapse the depth.

            **A housing rather than one big window**, which is the change the
            seats forced: every seat below is a lit window of its own now, and
            a lit card inside a lit pane reads as glass on glass. This is the
            manager card's bezel-and-windows grammar one plane down. */}
        <div
          ref={panelRef}
              style={panelStyle}
          // **A scroller of its own, sized to the shell.** It fills what the
          // parked card has left and scrolls its whole self — the sync key, both
          // lineups and the note under them together — for the reason in the
          // module note: the two panes are read across each other, and two
          // scrollers is what would put their rows out of step. `min-h-0` is the
          // half of that which is silent when missing: a flex item's default
          // `min-height: auto` refuses to shrink below its content, so the cap
          // would be a number nothing obeyed.
          className={`${CONSOLE_HOUSING_INSET} lab-scroll-glass mt-3 min-h-0 overflow-y-auto px-3 pb-3 pt-3.5 font-mono sm:px-[1.125rem] sm:pb-[1.125rem] sm:pt-4`}
        >
          {/* **Nothing is rendered while the card is shut**, which is the same
              bound `ExpandedPanel` takes one tool over — see `usePanelCap`'s
              `mounted`. Two full lineups per card times a hundred cards is a
              document nothing can lay out at speed. */}
          {!panelMounted ? null : (
          <>
          {/* Above the panes rather than in the summary: a `<summary>` is a
              leaf button to assistive technology, so a control nested in one is
              unreliably reachable and a live region inside it is swallowed into
              the disclosure's name. It also lands beside the empty state below,
              which is the case a sync most often fixes. */}
          <div className="relative">
            <LeagueSyncKey
              leagueId={league.league_id}
              leagueName={league.name}
              onSynced={onSynced}
            />
          </div>
          {entry ? (
            <>
              <WeekPanes entry={entry} teamName={league.team_name} />
              {entry.unknown_slots.length > 0 && (
                // A partial lineup must say so — see `unknown_slots` on the
                // contract. Under both panes, because it is true of both: the
                // opponent is solved through the same slots.
                <p className="relative m-0 pt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
                  Not shown: {entry.unknown_slots.join(", ")}
                </p>
              )}
            </>
          ) : (
            <p className="relative m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
              No lineup read for this league this week
            </p>
          )}
          </>
          )}
        </div>
      </details>
    </li>
  );
});

/**
 * The week's projected outcome: this lineup against the one it plays, and —
 * where the league runs one — against the league's median beside it, then
 * the record the week adds up to.
 *
 * **Two bays or three, or nothing at all.** There is no opponent for a future week
 * (the sync fetches matchups only up to the week being played), for a week
 * Sleeper filed without a pairing, or where the opponent's roster is not
 * stored — and the honest answer to all three is no plate, not `128.4–0` and a
 * W. `opponent_points` is null in every one of them and never zero, which is
 * what makes the distinction drawable at all. A league that runs no median
 * matchup draws **one** bay rather than an empty second one, on the same rule
 * one grain down: `median_points` is null there and null is not a score.
 * The `Rec` bay is drawn wherever the plate is, and it is the one reading
 * that says what the league's week *is* in Sleeper's own terms — a median
 * league plays two games a week and is `2–0`, `1–1` or `0–2`, which is the
 * figure the page's `Proj rec` sums. See `leagueWeekRecord`.
 *
 * The head-to-head bay is what gates the plate even where a median exists.
 * That is deliberate: this plate is the week's *game*, and a median standing
 * alone on it — over a lineup the card is already captioning "as set now" —
 * would be a reading of a week nobody has been scheduled for.
 *
 * **The bays stack their label over their figure**, which is `PlateBay`'s whole
 * argument: two readings side by side are 377px of a 620px card against 281px
 * stacked, and the difference is exactly what the league name opposite was
 * losing. Height is the one dimension nothing else on this card wants — at a
 * *phone's* width there is none of it to spend either, which is why the second
 * bay drops below `sm`; the measurement is on the branch that does it.
 *
 * Each pip takes its colour from `rankColor`, the same red→green ramp the
 * manager card's rank tiles run on, rather than from a second green and a
 * second red — one ramp, so a good outcome is the same green everywhere and
 * both ends invert for light mode together.
 *
 * **A dead heat draws a neutral pip rather than no pip.** Two lineups
 * projecting to the hundredth of a point is vanishingly rare and a real answer
 * when it happens; leaving the pip off would spell it the same way as "no
 * opponent", which is the one thing this plate is careful about.
 */
function ProjectionPlate({ entry }: { entry?: LineupCheckLeague | null }) {
  const record = leagueWeekRecord(entry);
  if (!entry || entry.opponent_points === null || !record) return null;

  const mine = entry.current_points;
  const theirs = entry.opponent_points;
  const median = entry.median_points;

  return (
    <ReadingPlate tight>
      <PlateBay label="Proj">
        {mine.toFixed(1)}–{theirs.toFixed(1)}
        {/* **Below `sm` the pip is the week's record**, and that is the one
            place the median reaches a phone. The median bay is dropped there
            (measured below), and a lamp reading `W` over a league that is
            `2–0` for the week says half of what the card knows. `2–0` in the
            lamp's own place costs a lozenge's width over a disc's — estimated,
            not rendered — against the ~88px a second bay would,
            and for a league with no median it reads `1–0`, which is the same
            letter one grain more exact. From `sm` up the two bays carry a pip
            each and the record has a bay of its own, so the lamp goes back
            to being the head-to-head's alone. `display: none` on the copy
            not shown keeps exactly one in the accessibility tree. */}
        <span className="hidden sm:contents">
          <OutcomePip mine={mine} against={theirs} />
        </span>
        <span className="contents sm:hidden">
          <RecordPip record={record} />
        </span>
      </PlateBay>
      {median !== null && (
        // **The median bay drops below `sm`, and that is measured.** The plate
        // sits opposite a league name that truncates, so every pixel it spends
        // is a character off the card's own subject — and at 390 the two-bay
        // plate is 233px of a 322px row, which leaves the name **20px: one
        // character**. Dropped, a median league's plate is 145px and its name
        // 108px, which is exactly what every other league on the page already
        // gets. The alternative measured against it — keeping both bays and
        // setting the head-to-head as `128.4` alone — buys the name back only
        // to 74px *and* loses the opponent's total, which is a number the
        // expanded half no longer states either.
        //
        // It is `hidden`/`sm:contents` rather than a second render, on
        // `StandingPlate`'s own rule one card over: `display: none` takes the
        // bay out of the accessibility tree as well as off the screen, so a
        // phone reader is not read a figure nobody can see. `contents` rather
        // than `inline-flex` because the plate is `items-stretch` and the
        // divider has to be a flex item of the plate itself to run its height.
        <>
          <span className="hidden sm:contents">
            {/* Stretched, so the cut runs the bays' own height — a fixed 17px
                centred in a 34px stack reads as a dash rather than a
                channel. */}
            <PlateDivider stretch />
          </span>
          <span className="hidden sm:contents">
            <PlateBay label="Med">
              {median.toFixed(1)}
              <OutcomePip mine={mine} against={median} median />
            </PlateBay>
          </span>
        </>
      )}
      {/* **The week's record for this league, as its own bay.** One game for
          most leagues and two where the league runs a median — which is what
          Sleeper's own standings write down for the week, and the figure the
          plate above the list sums. It is `leagueWeekRecord`'s answer, the
          same fold the page's `Proj rec` reads, so a card reading `2–0`
          cannot sit under a plate that counted it once. It is drawn beside the
          pips rather than instead of them: a pip says which game went which
          way, and the record says what the week adds up to. `sm` up only —
          below it the record has taken the pip's place in the first bay. */}
      <span className="hidden sm:contents">
        <PlateDivider stretch />
        <PlateBay label="Rec">
          <span className="sr-only">
            {record.median
              ? `Projected ${formatRecord(record)} for the week, median game included`
              : `Projected ${formatRecord(record)} for the week`}
          </span>
          <span aria-hidden>{formatRecord(record)}</span>
        </PlateBay>
      </span>
    </ReadingPlate>
  );
}

/**
 * The W/L/T lamp on a bay's own figure line.
 *
 * One component for both bays rather than two, because the two readings are
 * the same question asked of two opponents — and a second spelling is how the
 * median's tie could come to be drawn in a green the head-to-head's is not.
 * `median` changes only the word a screen reader gets, since the letter is the
 * same letter and the bay above it already says which comparison this is.
 */
function OutcomePip({
  mine,
  against,
  median = false,
}: {
  mine: number;
  against: number;
  /** Whether this is the bay read against the league median. */
  median?: boolean;
}) {
  // 1 for a win, 0 for a loss, 0.5 for a tie — the ramp's own ends and middle.
  const outcome = mine > against ? 1 : mine < against ? 0 : 0.5;
  const letter = outcome === 1 ? "W" : outcome === 0 ? "L" : "T";
  const result = outcome === 1 ? "win" : outcome === 0 ? "loss" : "tie";

  return (
    <Lamp
      percentile={outcome * 100}
      name={median ? `Projected ${result} against the median` : `Projected ${result}`}
    >
      {letter}
    </Lamp>
  );
}

/**
 * The week's record as a lamp, where the phone plate has room for one lamp and
 * not for a second bay.
 *
 * Its tone is the pip's own scale one game wider — wins as a share of the
 * games with a result, so `2–0` is the green a `W` is, `1–1` the neutral a
 * `T` is, and `0–2` the red an `L` is. Not `winSharePercentile`, which
 * stretches a *season's* .250–.750 band across the ramp: over one or two
 * games there is no band to stretch, and a `1–0` read through it would land
 * at the same full green as a `W` anyway, with a `1–1` off the neutral for no
 * reason a reader could see. A tie is left out of the share, on that
 * function's own rule — it is neither result.
 */
function RecordPip({ record }: { record: LeagueWeekRecord }) {
  const played = record.wins + record.losses;
  const share = played === 0 ? 0.5 : record.wins / played;
  const text = formatRecord(record);

  return (
    <Lamp
      percentile={share * 100}
      name={
        record.median
          ? `Projected ${text} for the week, median game included`
          : `Projected ${text} for the week`
      }
      wide
    >
      {text}
    </Lamp>
  );
}

/**
 * The lit lamp both pips are drawn on: a bordered disc of readout glass with
 * its letter — or its record — coloured off the rank ramp.
 *
 * `rankColor` rather than a second green and a second red, so a good outcome
 * is the same green everywhere on the console and both ends invert for light
 * mode together. `wide` lets the disc stretch into a lozenge for a record,
 * which is three characters where a letter is one; the height is the same so
 * the two sit on the figure line identically.
 */
function Lamp({
  percentile,
  name,
  wide = false,
  children,
}: {
  percentile: number;
  /** The screen reader's sentence — the visible text is the letter alone. */
  name: string;
  wide?: boolean;
  children: string;
}) {
  const tone = rankColor(percentile);

  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center justify-center rounded-full border border-active/45 bg-[image:var(--readout-bg)] font-mono text-[length:var(--fs-11)] font-medium tabular-nums shadow-[inset_0_0_12px_var(--accent-glow)] ${
        wide ? "min-w-5 px-1.5" : "w-5"
      }`}
      style={{ color: tone, textShadow: `0 0 10px ${rankColor(percentile, 0.6)}` }}
    >
      <span className="sr-only">{name}</span>
      <span aria-hidden>{children}</span>
    </span>
  );
}

/**
 * One reading, as a lit window — the same surface as the console's readouts.
 *
 * **Three lines on a desktop and three on a phone, and they are not the same
 * three.** A desktop tile has room for the whole reading on one line, so it
 * reads *name over scope*, then the figure: `Vs optimal` / `Best reachable` /
 * `−6.6`. A phone tile is ~72px of content and cannot fit `2 to move` at
 * `--fs-21` on any line at all, so it drops the scope — the quietest of the
 * three, and the only one that is a gloss rather than an answer — and splits
 * the figure into the numeral and its unit: `Kickoff` / `2` / `to move`.
 *
 * The two shapes come off one {@link MetricCell} and are drawn by one node
 * with two layouts, not by two nodes with one hidden: a tile rendered twice is
 * every reading in the DOM twice and read twice to anything listening.
 *
 * **The min-height is on the label block, not on either line**, which is what
 * holds every figure in the row on one baseline — a two-line label beside a
 * one-line label would otherwise push its own figure down and the strip would
 * read as four tiles at four heights. On a phone the same job is done by
 * `mt-auto` on the figure, which bottom-aligns them instead: there is no scope
 * line there to make the labels uneven, and the unit under the figure is what
 * has to end level.
 *
 * **The name leads and the scope follows it**, on the manager card's own
 * hierarchy: the thing being qualified is `--fs-11` on `--readout-line` and
 * the qualifier is `--fs-10` on `--readout-label`. Teal rather than the
 * housing's foreground because on a housing the windows are the only lit
 * surface, and a label in the metal's own colour would read as belonging to
 * the metal rather than to the glass it is printed on.
 *
 * The value switches on the cell's own state rather than on a boolean, so the
 * four tones stay four — see `MetricCell`. A **clear** draws the checkmark in
 * place of the numeral, which is why `cell.text` survives as the mark's
 * `sr-only` name and why the unit line still prints beneath it on a phone.
 */
function MetricTile({ label, cell }: { label: string; cell: MetricCell }) {
  // **Two treatments where the state union has four**, and the difference is
  // deliberate. `alert` and `count` are both *figures* — a number the reader
  // is being handed — so they are struck the same way, in the red the page
  // reads as "this tile is saying something"; `clear` is the mark, and `none`
  // is the em dash. The union stays four-way regardless, because
  // `needsAttention` and `attentionByReason` read `alert` alone: an open
  // roster spot still sends nobody to a league that is in good order, which is
  // the whole reason `count` exists and is a question about the header rather
  // than about this tile's ink.
  const figure =
    cell.state === "none"
      ? // No answer at all: the muted ink, flat, and no extrusion — a struck
        // em dash reads as a reading rather than as its absence.
        "text-readout-muted"
      : STRUCK_FIGURE;

  return (
    <div
      className={`${CONSOLE_WINDOW} flex min-w-0 flex-col rounded-[0.625rem] px-[7px] py-2 sm:px-2 sm:py-2.5`}
      title={cell.title}
    >
      <Scanlines />
      <div className="relative sm:min-h-[1.625rem]">
        {/* **Untracked below `sm`, and that is a fit rather than a taste.**
            At `tracking-[0.08em]` in the 65px a 79px tile leaves, `Vs optimal`
            measures 70px and clips — which is the one label on the row that
            cannot be inferred from the figure under it. Dropping the tracking
            takes it to 61.6px. The manager card made the identical measurement
            on its own four-up strip. */}
        <p className="m-0 truncate font-mono text-[length:var(--fs-9)] uppercase leading-[1.2] text-readout-line sm:text-[length:var(--fs-11)] sm:tracking-[0.1em]">
          {label}
        </p>
        {/* Desktop only, and the reserved height is what keeps the row level
            when one tile has nothing to say — see `MetricCell.scope`, which is
            empty rather than naming a population nothing was measured over. */}
        <p className="m-0 mt-px hidden min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-10)] uppercase leading-[1.2] tracking-[0.12em] text-readout-label sm:block">
          {cell.scope}
        </p>
      </div>

      {/* `mt-auto` is the phone's baseline rule and a no-op on a desktop,
          where the label block's own min-height has already done it. The mark
          takes two pixels less above it than a figure does: it is 40px against
          the figure's 28 and eats most of the slack the old 24px pip left. */}
      <div className={`relative mt-auto ${cell.state === "clear" ? "pt-1.5" : "pt-2"}`}>
        {cell.state === "clear" ? (
          <CheckMark text={cell.text} title={cell.title} />
        ) : (
          <p
            className={`m-0 truncate font-mono text-[length:var(--fs-18)] font-medium leading-none tabular-nums sm:text-[length:var(--fs-24)] ${figure}`}
          >
            {/* The desktop reading whole, the phone's numeral alone — one
                measurement, two rooms. See `MetricCell`. */}
            <span className="sm:hidden">{cell.figure}</span>
            <span className="hidden sm:inline">{cell.text}</span>
          </p>
        )}
      </div>

      {/* What the numeral counts, on a phone only: above `sm` the reading on
          the line above already carries it. Empty where the figure needs none,
          and the tile keeps the height either way. */}
      <p className="relative m-0 mt-0.5 min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-label sm:hidden">
        {cell.unit}
      </p>
      <span className="sr-only">{cell.title}</span>
    </div>
  );
}

/**
 * A figure struck out of the glass, in the red the page reads as an answer.
 *
 * The same object as the mark opposite it, in the other medium: a gradient
 * clipped to the glyphs with the extrusion behind it, so a tile showing a
 * number and a tile showing the mark read as one row rather than as a mark
 * beside three labels.
 *
 * **The extrusion is `filter: drop-shadow()` and never `text-shadow`**, and
 * this is the thing to keep: with `background-clip: text` and a transparent
 * fill the element's background paints first and a `text-shadow` paints
 * *above* it, so the dark offset copies cover the gradient inside the glyph
 * bodies and the word renders as flat maroon with a 1px lit rim. Chained
 * `drop-shadow`s composite behind the clipped gradient — the same reason the
 * mark's shoulders are separate SVG paths rather than a shadow on one stroke.
 * Both halves of it are tokens, so light mode turns the whole stack over
 * rather than dimming it; see `globals.css`.
 *
 * `text-transparent` is Tailwind's `color`, which is what a browser with no
 * `background-clip: text` falls back to painting — so the fill is spelled as
 * well, and a glyph is never invisible on a browser that ignores the clip.
 */
const STRUCK_FIGURE =
  "bg-[image:var(--alert-face)] bg-clip-text text-transparent " +
  "[-webkit-text-fill-color:transparent] [filter:var(--alert-depth)]";

/**
 * The mark's face gradient, declared once for the whole page.
 *
 * An SVG stroke cannot take a CSS gradient, so the face is a
 * `<linearGradient>` referenced by `url(#…)` — and an SVG fragment reference
 * is resolved against the *document*, not against the `<svg>` it is written
 * in, which is what lets one declaration paint every mark on the page.
 *
 * **One declaration and not one per mark**, which is the whole reason this is
 * a separate export. Four tiles a card times a hundred cards is four hundred
 * identical `<defs>` blocks, and the alternative — a `useId` per instance —
 * would put a hook in a leaf of a card whose own note says it owns no state,
 * to buy four hundred gradients where one will do.
 *
 * The cost is a coupling worth stating: a page that mounts
 * {@link LineupCheckCard} without mounting this gets marks whose face stroke
 * resolves to nothing — the shoulders and the ridge draw and the neon does
 * not, which is a mark that looks dim rather than one that looks broken. It is
 * mounted beside the card list in `lineup-checker-home.tsx`.
 *
 * Zero-sized and absolutely positioned rather than `display: none`: a
 * gradient in a `display: none` subtree resolves in every current engine and
 * has not always, and a 0×0 box out of flow costs nothing to be sure.
 */
export function LineupMarkDefs() {
  return (
    <svg aria-hidden focusable="false" width={0} height={0} className="absolute">
      <defs>
        <linearGradient id={MARK_FACE_ID} x1="0" y1="0" x2="0.25" y2="1">
          {MARK_FACE_STOPS.map((stop) => (
            <stop
              key={stop.offset}
              offset={stop.offset}
              // A CSS property rather than the `stop-color` attribute, which is
              // what lets it name a token: a presentation attribute does not
              // resolve `var()`.
              style={{ stopColor: `var(${stop.token})` }}
            />
          ))}
        </linearGradient>
      </defs>
    </svg>
  );
}

/** The gradient's fragment id, spelled once — the mark and the defs share it. */
const MARK_FACE_ID = "lineup-mark-face";

/**
 * The face ramp, as offsets here and colours in `globals.css`.
 *
 * **One list, both themes.** The stops are the *shape* of the ramp and the
 * tokens are what it is made of, so the light scheme turns the colours over —
 * see the token block — without this file knowing there are two schemes.
 */
const MARK_FACE_STOPS: readonly { offset: number; token: string }[] = [
  { offset: 0, token: "--mark-face-0" },
  { offset: 0.2, token: "--mark-face-1" },
  { offset: 0.5, token: "--mark-face-2" },
  { offset: 0.78, token: "--mark-face-3" },
  { offset: 1, token: "--mark-face-4" },
];

/** The check, drawn once per copy: three shoulders, the face, and the ridge. */
const MARK_PATH = "M7 22.5L17.5 33L39 8";

/**
 * The ridge along the stroke's top, inset from it.
 *
 * Two paths run it: the standing specular, and the glint that sweeps it once
 * on mount. They are the same line because they are the same edge — a glint
 * that crossed the box rather than following the stroke would read as a
 * reflection on the glass behind the mark rather than on the mark.
 */
const MARK_RIDGE_PATH = "M8.4 21.6L17.6 30.8L37.8 7.2";

/**
 * A cleared check: the mark instead of the word.
 *
 * Four tiles of words is four things to read on a card whose whole job is to
 * be scanned past; a mark is the one shape a reader can take in without
 * reading. **The word stays as the mark's `sr-only` name** — the mark is the
 * whole of what a sighted reader gets, so `Set` and `In order` have to remain
 * available to everyone else, and `title` carries the units as it does on
 * every tile.
 *
 * **It has no housing at all**, which is the design's own conclusion after
 * three that did — a ring, a lens, a milled billet. A mark inside a bezel on a
 * card of bezels is one more instrument to read; struck straight onto the
 * glass it is the only thing on the tile that is not an instrument, which is
 * exactly what "there is nothing to do here" should look like.
 *
 * **It is four stacked strokes and a ridge, not a glyph with a shadow.** The
 * three shoulders are copies of the same path offset downward behind the face,
 * so the extrusion is *geometry* — a `filter` or a `text-shadow` on one stroke
 * would paint above or below the whole mark rather than behind the face and
 * in front of the shoulder under it. It is the same argument the red figure
 * opposite makes about `drop-shadow` against `text-shadow`, one medium over.
 *
 * Every colour is a token, so the whole stack turns over for light mode
 * without this file naming a scheme. The one literal is the glint, which is
 * white on either ground because it is a specular flash rather than ink.
 *
 * The phone draws the same box scaled to 36×31 rather than a second drawing:
 * the `viewBox` is unchanged, so the stroke keeps its ratio and the mark is
 * the same object at two sizes. A tile is ~72px of content there and a 46px
 * mark in it leaves the unit line under it nothing.
 */
function CheckMark({ text, title }: { text: string; title: string }) {
  return (
    // `line-height: 0` is what keeps the SVG's own box from carrying leading:
    // an inline replaced element sits on the text baseline, and the descender
    // space under it is what would push the unit line off a phone tile.
    <span title={title} className="inline-block leading-none">
      <svg
        width={46}
        height={40}
        viewBox="0 0 46 40"
        fill="none"
        aria-hidden
        focusable="false"
        className="h-[31px] w-[36px] [filter:var(--mark-glow)] sm:h-10 sm:w-[46px]"
      >
        <g fill="none" strokeLinecap="round" strokeLinejoin="round">
          {/* Back to front. The token is set as a CSS property rather than as
              the `stroke` attribute, which does not resolve `var()`. */}
          <path
            d={MARK_PATH}
            strokeWidth={8}
            transform="translate(0,4)"
            style={{ stroke: "var(--mark-shoulder-3)" }}
          />
          <path
            d={MARK_PATH}
            strokeWidth={8}
            transform="translate(0,2.5)"
            style={{ stroke: "var(--mark-shoulder-2)" }}
          />
          <path
            d={MARK_PATH}
            strokeWidth={8}
            transform="translate(0,1.2)"
            style={{ stroke: "var(--mark-shoulder-1)" }}
          />
          <path d={MARK_PATH} strokeWidth={8} stroke={`url(#${MARK_FACE_ID})`} />
          <path
            d={MARK_RIDGE_PATH}
            strokeWidth={1.7}
            style={{ stroke: "var(--mark-specular)" }}
          />
          {/* One sweep on mount and nothing after it. `both` fill is what makes
              that true at both ends — invisible before the delay and invisible
              after the run — so the mark needs no state either side of it.
              `.lab-anim` is the app's one reduced-motion hook, and the
              animation is set inline because that rule's `!important` is
              written for exactly this. */}
          <path
            className="lab-anim"
            d={MARK_RIDGE_PATH}
            stroke="#ffffff"
            strokeWidth={4}
            strokeDasharray="12 60"
            style={{
              animation: "mark-glint 1.15s cubic-bezier(0.3,0.7,0.3,1) 0.35s 1 both",
              filter: "blur(1px)",
            }}
          />
        </g>
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}
