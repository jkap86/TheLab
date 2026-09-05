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
  PlateField,
  rankColor,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";

import {
  gapCell,
  kickoffCell,
  rosterCell,
  superflexCell,
  type MetricCell,
} from "../helpers/lineup-check-metrics";
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
 * **The open card's housing freezes under the rack**, which is `LeagueCard`'s
 * own arrangement and has to be the `<summary>`: the `<li>` and the
 * `<details>` are the whole card, taller than the viewport, and sticky on a
 * box that never fits does nothing at all. The summary's containing block is
 * the `<details>`, which is exactly the range the tiles should stay over —
 * it parks at the offset and releases when the card's own bottom edge catches
 * it, so it never outlives its league.
 *
 * A fourth constraint travels with the card: the depth chrome rides
 * `pointer-fine:`, because one card per league times several composited planes
 * each is what kills an iOS Safari tab when a card opens. `LeagueCard` carries
 * the argument in full; the gate must stay on both, since this page renders the
 * same card over the same league list.
 */

export function LineupCheckCard({
  league,
  entry,
  onSynced,
}: {
  league: ManagerLeague;
  /** This league's week, once the check lands. Undefined while it is in flight. */
  entry?: LineupCheckLeague | null;
  /** Re-read this league after its sync key changed something. Forwarded only. */
  onSynced?: (leagueId: string) => void;
}) {
  const gap = gapCell(entry);
  const kickoff = kickoffCell(entry);
  const superflex = superflexCell(entry);
  const roster = rosterCell(entry);

  return (
    <li className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10">
      {/* `min-w-0` is what lets the card shrink to a phone. The `<li>` is a
          row flex container, so its item takes `min-width: auto` and refuses
          to go below its own min-content — and the expanded half's two panes
          sit side by side at every width by design, which puts that
          min-content above 390. Without this the card is wider than the
          viewport and the whole page scrolls sideways. */}
      <details className={`group/card ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col`}>
        <summary
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
            // **The open card's housing freezes under the rack**, so the four
            // tiles stay in view while the panes scroll past — see the note
            // above the component on why it is the `summary` and nothing else.
            "group-open/card:sticky group-open/card:top-[var(--card-freeze-top)] group-open/card:z-20 " +
            "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
            "pointer-fine:hover:[transform:translateZ(30px)_rotateX(0deg)] " +
            "pointer-fine:group-open/card:[transform:translateZ(20px)_rotateX(0deg)] " +
            "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
            "hover:border-active/45 group-open/card:border-active/45 " +
            "pointer-fine:hover:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "pointer-fine:group-open/card:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >
          {/* Everything decorative, in the one layer that clips. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-open/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-open/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-open/card:opacity-100" />
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
        <div className={`${CONSOLE_HOUSING_INSET} mt-3 px-3 pb-3 pt-3.5 font-mono sm:px-[1.125rem] sm:pb-[1.125rem] sm:pt-4`}>
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
        </div>
      </details>
    </li>
  );
}

/**
 * The week's projected outcome: this lineup against the one it plays.
 *
 * **Two figures and a pip, or nothing at all.** There is no opponent for a
 * future week (the sync fetches matchups only up to the week being played), for
 * a week Sleeper filed without a pairing, or where the opponent's roster is not
 * stored — and the honest answer to all three is no plate, not `128.4–0` and a
 * W. `opponent_points` is null in every one of them and never zero, which is
 * what makes the distinction drawable at all.
 *
 * The pip takes its colour from `rankColor`, the same red→green ramp the
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
  if (!entry || entry.opponent_points === null) return null;

  const mine = entry.current_points;
  const theirs = entry.opponent_points;
  // 1 for a win, 0 for a loss, 0.5 for a tie — the ramp's own ends and middle.
  const outcome = mine > theirs ? 1 : mine < theirs ? 0 : 0.5;
  const letter = outcome === 1 ? "W" : outcome === 0 ? "L" : "T";
  const tone = rankColor(outcome * 100);

  return (
    <ReadingPlate tight>
      <PlateField label="Proj">
        {mine.toFixed(1)}–{theirs.toFixed(1)}
      </PlateField>
      <span
        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border border-active/45 bg-[image:var(--readout-bg)] font-mono text-[length:var(--fs-13)] font-medium shadow-[inset_0_0_12px_var(--accent-glow)]"
        style={{ color: tone, textShadow: `0 0 10px ${rankColor(outcome * 100, 0.6)}` }}
      >
        <span className="sr-only">
          {letter === "W"
            ? "Projected win"
            : letter === "L"
              ? "Projected loss"
              : "Projected tie"}
        </span>
        <span aria-hidden>{letter}</span>
      </span>
    </ReadingPlate>
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
  const tone =
    cell.state === "alert"
      ? "text-error [text-shadow:0_0_12px_rgba(252,165,165,0.45)]"
      : cell.state === "count"
        ? "text-readout [text-shadow:var(--readout-text-glow)]"
        : // No answer at all: the muted ink and no glow, because a lit em dash
          // reads as a reading rather than as its absence.
          "text-readout-muted";

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
          where the label block's own min-height has already done it. */}
      <div className="relative mt-auto pt-2">
        {cell.state === "clear" ? (
          <CheckMark text={cell.text} title={cell.title} />
        ) : (
          // Full opacity on every tone: the light-mode teal is only ~5:1
          // against the page, and an alpha drops it below AA.
          <p
            className={`m-0 truncate font-mono text-[length:var(--fs-17)] font-medium leading-none tabular-nums sm:text-[length:var(--fs-21)] ${tone}`}
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
 * A cleared check: the mark instead of the word.
 *
 * Four tiles of words is four things to read on a card whose whole job is to be
 * scanned past; a mark is the one shape a reader can take in without reading.
 * **The word stays as the mark's `sr-only` name** — the mark is the whole of
 * what a sighted reader gets, so `Set` and `In order` have to remain available
 * to everyone else, and `title` carries the units as it does on every tile.
 *
 * The stroke resolves from `text-readout` on the wrapper, so the glyph inverts
 * with the theme rather than naming a colour of its own.
 */
function CheckMark({ text, title }: { text: string; title: string }) {
  return (
    <span
      title={title}
      className="mt-1.5 inline-flex size-6 items-center justify-center rounded-full border border-active/40 bg-[radial-gradient(closest-side,rgba(0,255,229,0.16),transparent)] text-readout shadow-[inset_0_0_12px_rgba(0,255,229,0.3),0_0_14px_-6px_rgba(0,255,229,0.6)]"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-[15px] [filter:drop-shadow(0_0_6px_rgba(0,255,229,0.75))]"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4.5 12.6l4.8 4.8L19.5 7.2" />
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}
