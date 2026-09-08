"use client";

import { memo, type MouseEvent } from "react";

import type { LineupCheckLeague, ManagerLeague } from "@/shared/contract";
import {
  CardBilletRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  ExpandedPanel,
  GameChip,
  LeagueConfigWindow,
  LeagueBillet,
  RampFigure,
  sharePercentile,
  Scanlines,
  StandingBay,
  StandingStrip,
} from "@/features/shared";

import {
  gapCell,
  kickoffCell,
  rosterCell,
  superflexCell,
  type MetricCell,
} from "../helpers/lineup-check-metrics";
import { leagueWeekRecord, type WeekGame } from "../helpers/week-summary";
import { LeagueSyncKey } from "./league-sync-key";
import { WeekPanes } from "./week-panes";

/**
 * One league's week, as an instrument housing that rises toward the viewer.
 *
 * The leagues console's card with a different pair of numbers in it, and
 * deliberately the same object: a reader arriving here from `/manager` is
 * looking at the same leagues, and two cards drawn to hold a league would be
 * two chances for one of them to drift. So it carries the same housing, the
 * same billet with the avatar lit in its bezel, and the same league config
 * strip — with the week's projected outcome on a milled strip under it, where
 * the manager card puts `Rank / Rec / Pts`, and four checks on the window row
 * where that card puts its ranks.
 *
 * **The billet row carries the league alone, and that is a width.** The week's
 * readings used to share it as a raised plate, and a plate opposite the name is
 * width the *name* is paying for: measured on the design's own render the name
 * needs 312px to set and the plate left it 270, and at 390 the two-bay plate
 * left it 20px — one character, which is why that plate dropped its median bay
 * below `sm`. On its own line nothing competes, nothing is dropped for width
 * any more, and the row is the manager card's to the pixel.
 *
 * **The billet is not stretched to the row**, which is the one place this
 * parts company with the design bundle's letter and keeps its intent: the
 * manager card's billet hugs its content, and a checker billet run to the full
 * width would be a *different object* on the two pages — the drift the pass
 * exists to remove. Hugging, the name still takes as much of the row as it
 * needs and truncates only past it, which is the measured requirement.
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
 * **The expanded half is an {@link ExpandedPanel}**, which is the manager and
 * trade cards' own — so the two halves of the card are one piece of stock under
 * a milled groove rather than a housing set inside a housing, and the summary
 * hands it the bottom inset while it is open. That component owns the cap, the
 * `mounted` gate and the perspective, which is what takes the last hook off
 * this card and makes the claim above true again.
 *
 * It used to scroll as **one** block, on the argument that its two lineups are
 * read across each other and two scrollers would put them out of step. That
 * argument is right and is answered rather than dropped: the panes scroll their
 * own lists, as the manager card's do, and `WeekPanes` links the two.
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
            // `pt` clears the billet hung 16px / 18px above the edge — it
            // rose 4px from `sm` when the plate became a billet, and the
            // manager card made the same change. The bottom padding stays:
            // this card's expanded half is still its own housing under the
            // summary rather than the same stock under a groove, so there is
            // no seam here to close.
            //
            // **`flex-1` while shut and `flex-none` while open.** The
            // `<details>` is a column flex container and the expanded half
            // below is sized from this header's height (`panel.offsetTop`, in
            // {@link usePanelCap}) — so a header that grows absorbs the
            // panel's slack and the measurement reads back the panel's own
            // size. Around `MIN_PARKED` that has two self-consistent answers
            // and it alternates between them forever; the manager card carries
            // the same rule and the driven figures for it.
            //
            // **The bottom padding is 0 while the card is open.** The expanded
            // half is no longer a housing set into the card — it is the same
            // piece of stock under a milled groove, and the groove is the
            // panel's first child (see `ExpandedPanel`). So the summary hands
            // its bottom inset to the panel for as long as there is a panel;
            // shut, a card is one housing and keeps it, or the four windows
            // would sit flush on its bottom edge. `group-open` rather than
            // `group-data-[lit]` because the padding has to hold through the
            // collapse: `lit` goes off as the close *begins*, and 18px
            // returning under a panel still clipping shut is a jump. The
            // manager card carries the same rule.
            `lab-card-3d ${CONSOLE_CARD_SHELL} pb-[1.125rem] pt-[1.875rem] sm:pt-[2.125rem] group-open/card:pb-0 flex flex-1 group-open/card:flex-none cursor-pointer list-none flex-col font-mono ` +
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
          <CardBilletRow>
            <LeagueBillet name={league.name} avatarUrl={league.avatar_url} />
          </CardBilletRow>

          <CardRule />

          {/* What game this league is playing, then how the week is going at
              it — the manager card's own order, and its own two parts. The
              settings strip is that card's component, so a league described one
              way there cannot be described another here; the projection strip
              below it is `StandingStrip` where the manager card puts its
              standing, cut from the same billet stock so the pair reads as one
              machined block. `18px` sits between the windows' 22px and the
              billet, so the planes read front to back.

              **Both take their own line, at every width.** The manager card
              shares this row from `sm` up and its settings strip wraps for it;
              measured at a 620px card the settings strip needs ~512px
              un-wrapped and a 289px part beside it leaves 285, so it breaks to
              three lines — 81px — where the two on their own lines are 35px
              each. Sharing costs more than it saves here, which is also why
              `LeagueConfigWindow` is *not* told it is `shared`: it has the full
              width, so its own `md` and `sm` arms are unchanged and nothing
              clips. */}
          <div className="relative mt-3 flex flex-col items-stretch gap-2 sm:mt-3.5 pointer-fine:[transform:translateZ(18px)]">
            <LeagueConfigWindow league={league} />
            <ProjectionStrip entry={entry} />
          </div>

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

        {/* **The expanded half is the card's own bottom half**, not a housing
            set into it: `ExpandedPanel` paints no surface, cuts a milled groove
            where the border was, and sizes itself into what the parked shell
            has left. It is the manager and trade cards' own component, which is
            what makes the three open halves one object rather than three.

            It stays *outside* the summary's `preserve-3d` subtree, as it always
            has, and owns a shallow perspective of its own instead — not the
            same claim: `preserve-3d` cannot survive a clip and `perspective`
            can, so the panel can both hold its parts on their own planes and
            keep the `overflow: hidden` its radius needs.

            **No wrapper between the panel and its parts**, which is the half of
            that perspective which is silent when it is missing: a perspective
            projects an element's *direct* children only, and an intermediate
            `<div>` is `transform-style: flat` — so the control strip and the
            panes would compute their `translateZ` against no projection at all,
            with no error to say so. The fragment below is not an element. */}
        <ExpandedPanel open={open} closing={open && !lit}>
          {/* Card-scoped controls, in the recess the manager card's history
              rail stands in — same height, same stock, same place, so a reader
              crossing between the two tools finds the card's own controls where
              they left them.

              Above the panes rather than in the summary: a `<summary>` is a
              leaf button to assistive technology, so a control nested in one is
              unreliably reachable and a live region inside it is swallowed into
              the disclosure's name. It also lands beside the empty state below,
              which is the case a sync most often fixes. */}
          <div className="mb-2 flex h-[30px] shrink-0 flex-nowrap items-center gap-1.5 rounded-full bg-[color:var(--recess-bg)] pl-1.5 pr-3.5 shadow-[var(--track-shadow)] sm:mb-2.5 sm:h-8 sm:gap-2.5 sm:pr-4 pointer-fine:[transform:translateZ(4px)]">
            <LeagueSyncKey
              leagueId={league.league_id}
              leagueName={league.name}
              onSynced={onSynced}
            />
          </div>

          {entry ? (
            <WeekPanes entry={entry} teamName={league.team_name} />
          ) : (
            <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
              No lineup read for this league this week
            </p>
          )}

          {entry && entry.unknown_slots.length > 0 && (
            // A partial lineup must say so — see `unknown_slots` on the
            // contract. Under both panes, because it is true of both: the
            // opponent is solved through the same slots. `shrink-0`, so it
            // takes its line out of the panel rather than out of the panes'
            // own height being negotiated around it.
            <p className="m-0 shrink-0 pt-2.5 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
              Not shown: {entry.unknown_slots.join(", ")}
            </p>
          )}
        </ExpandedPanel>
      </details>
    </li>
  );
});

/**
 * The week's projected outcome as a **milled strip**: the two comparisons as
 * signed margins, and the week they add up to as one chip per game.
 *
 * **It is the manager card's standing, one tool over.** That card puts
 * `Rank / Rec / Pts` on a `StandingStrip` bolted to the housing under the
 * settings; this puts `Proj / Med / Rec` on the same part, in the same place,
 * cut from the same stock. The two pages list the same leagues, so the header
 * is the same object with a different pair of numbers in it — which is the
 * whole of what this replaced a raised plate for.
 *
 * **The margins are signed, where the plate printed both totals.** `141.0–121.7`
 * is two numbers a reader has to subtract; `+19.3` is the answer, and the two
 * totals are not lost — they are the `Set` reading on each pane's own ledge,
 * one seam down. An explicit `+` because the sign is the reading: a margin
 * printed bare would read as a score.
 *
 * **Two bays or three, or nothing at all.** There is no opponent for a future
 * week (the sync fetches matchups only up to the week being played), for a week
 * Sleeper filed without a pairing, or where the opponent's roster is not stored
 * — and the honest answer to all three is no strip, not `+128.4` and a W.
 * `opponent_points` is null in every one of them and never zero, which is what
 * makes the distinction drawable at all.
 *
 * **A league with no median matchup draws two bays, never `Med —`.** The app's
 * em dash means "this league has this field and we have no answer for it" — the
 * reading the manager card's `Rank —` makes before a season starts. A league
 * that runs no median has no such field, so a dash there would read as a median
 * the sync failed to fetch: two bays state the league, three state a fault. The
 * bays stretch, so two of them fill the line rather than leaving a hole where a
 * third would have been.
 *
 * The head-to-head is what gates the strip even where a median exists. That is
 * deliberate: this is the week's *game*, and a median standing alone on it —
 * over a lineup the card is already captioning "as set now" — would be a
 * reading of a week nobody has been scheduled for.
 */
function ProjectionStrip({ entry }: { entry?: LineupCheckLeague | null }) {
  const record = leagueWeekRecord(entry);
  if (!entry || entry.opponent_points === null || !record) return null;

  const mine = entry.current_points;
  const median = entry.median_points;

  return (
    <StandingStrip stretch>
      <MarginBay label="Proj" mine={mine} against={entry.opponent_points} />
      {median !== null && <MarginBay label="Med" mine={mine} against={median} />}
      {/* **One chip per game, head-to-head first**, which is the strip's own
          left-to-right order — so the first maps onto `Proj` and the second
          onto `Med`, and the part itself says which is which. That is a
          reading `1–1` cannot make: it says *which* of the two went which way.
          The bay draws no ink of its own, because each chip carries its own —
          see `StandingBay`'s `tone`. */}
      <StandingBay label="Rec" stretch>
        <span className="inline-flex items-center gap-1">
          {record.games.map((game) => (
            <GameChip
              key={game.against}
              percentile={OUTCOME_PERCENTILE[game.result]}
              name={`Projected ${game.result} against ${AGAINST[game.against]}`}
            >
              {OUTCOME_LETTER[game.result]}
            </GameChip>
          ))}
        </span>
      </StandingBay>
    </StandingStrip>
  );
}

/**
 * One comparison, as a signed margin polished in the ramp's own hue.
 *
 * **The colour is the margin's size, not which way it went** — the chip beside
 * it already says that, and a rank ramp fed a win/lose boolean would paint a
 * 0.4-point squeaker the same green as a thirty-point rout. `sharePercentile`
 * is the scale the standings table already reads its totals on: a margin as a
 * share of what the two sides average, saturating at ±10%, which lands a dead
 * heat on the neutral and a comfortable win at the ramp's end.
 *
 * **The sign is decided after rounding**, so a margin that rounds to nothing
 * prints `0.0` rather than `−0.0` — and a `0.0` beside an `L` is true rather
 * than contradictory: the game was that close, and the chip is what settles it.
 */
function MarginBay({
  label,
  mine,
  against,
}: {
  label: string;
  mine: number;
  against: number;
}) {
  const margin = Number((mine - against).toFixed(1));
  const sign = margin > 0 ? "+" : margin < 0 ? "\u2212" : "";

  return (
    <StandingBay label={label} stretch>
      <RampFigure percentile={sharePercentile(mine, [mine, against])}>
        {sign}
        {Math.abs(margin).toFixed(1)}
      </RampFigure>
    </StandingBay>
  );
}

/** The ramp's own ends and middle: a win, a loss, a dead heat. */
const OUTCOME_PERCENTILE: Record<WeekGame["result"], number> = {
  win: 100,
  loss: 0,
  tie: 50,
};

const OUTCOME_LETTER: Record<WeekGame["result"], string> = {
  win: "W",
  loss: "L",
  tie: "T",
};

/** What each chip's sentence names, so `W W` is never announced as "W W". */
const AGAINST: Record<WeekGame["against"], string> = {
  opponent: "this week\u2019s opponent",
  median: "the league median",
};

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
 *
 * **The extrusion rides `pointer-fine:`**, on the card's own per-device
 * budget: a `filter` is a compositor buffer per element, and this is up to
 * four per card on a page with no virtualizer — the same per-card filter
 * buffer the league card's title is gated for, and the same iOS Safari tab
 * kill behind it. A coarse pointer gets the red ramp clipped to the glyphs,
 * without the cast.
 */
const STRUCK_FIGURE =
  "bg-[image:var(--alert-face)] bg-clip-text text-transparent " +
  "[-webkit-text-fill-color:transparent] pointer-fine:[filter:var(--alert-depth)]";

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
        // The bloom is a `filter`, gated with the struck figure's for the same
        // per-device reason: a cleared page is four of these a card.
        className="h-[31px] w-[36px] sm:h-10 sm:w-[46px] pointer-fine:[filter:var(--mark-glow)]"
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
              written for exactly this.

              **No `blur()` on it.** A filter under an animation is a
              compositor buffer re-rasterised per frame, and a cleared page
              runs up to four of these a card at once on mount — ~450 blurred
              animating SVGs on a 113-league page. The softness the blur bought
              is approximated by a slightly wider stroke at less than full
              `stroke-opacity`: that property is not one the keyframes animate,
              so it composes with their opacity ramp rather than fighting it. */}
          <path
            className="lab-anim"
            d={MARK_RIDGE_PATH}
            stroke="#ffffff"
            strokeWidth={4.6}
            strokeOpacity={0.72}
            strokeDasharray="12 60"
            style={{
              animation: "mark-glint 1.15s cubic-bezier(0.3,0.7,0.3,1) 0.35s 1 both",
            }}
          />
        </g>
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}
