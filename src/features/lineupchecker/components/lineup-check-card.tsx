import type { LineupCheckLeague, ManagerLeague } from "@/shared/contract";
import {
  CardPlateRow,
  CardRule,
  CONSOLE_CARD,
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
  kickoffTime,
  rosterCell,
  superflexCell,
  type MetricCell,
} from "../helpers/lineup-check-metrics";
import { LeagueSyncKey } from "./league-sync-key";

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
 * `onSynced` is forwarded to `LeagueSyncKey` and never called here, which is
 * what keeps that true — the state a card needs lives below it.
 *
 * A fourth constraint travels with the card: the depth chrome rides
 * `pointer-fine:`, because one card per league times several composited planes
 * each is what kills an iOS Safari tab when a card opens. `LeagueCard` carries
 * the argument in full; the gate must stay on both, since this page renders the
 * same card over the same league list.
 */

/** Sleeper's slot names, shortened to fit a chip. Unmapped ones render as-is. */
const SLOT_LABELS: Record<string, string> = {
  SUPER_FLEX: "SF",
  WRRB_FLEX: "W/R",
  REC_FLEX: "W/T",
  IDP_FLEX: "IDP",
  FLEX: "FLX",
};

const slotLabel = (slot: string): string => SLOT_LABELS[slot] ?? slot;

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
      <details className="group/card flex min-w-0 flex-1 flex-col">
        <summary
          className={
            `lab-card-3d ${CONSOLE_CARD} flex flex-1 cursor-pointer list-none flex-col font-mono ` +
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
            <p className="relative mt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/[0.78] pointer-fine:[transform:translateZ(14px)]">
              Lineup as set now
            </p>
          )}

          {/* A direct child of the summary, so the `translateZ` survives: a
              plain wrapper here is a flat rendering context and the depth would
              go with no error to say so. Two across on a phone and four from
              `sm`, on the manager card's own `GRID_COLS[4]` rule — a four-way
              split at 390 is 70px a tile, narrower than the reading it holds. */}
          <div className="relative mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 pointer-fine:[transform:translateZ(22px)]">
            <MetricTile label="Vs optimal" cell={gap} />
            <MetricTile label="Kickoff" cell={kickoff} />
            <MetricTile label="Superflex" cell={superflex} />
            <MetricTile label="Roster" cell={roster} />
          </div>
        </summary>

        {/* Outside the 3D context on purpose: a lineup table inside a
            `preserve-3d` subtree pays for a composited layer per row and gains
            nothing, since none of it is tilted. */}
        <div className={`${CONSOLE_WINDOW} mt-3 rounded-xl px-3.5 py-0.5`}>
          <Scanlines />
          {/* Above the lineup rather than in the summary: a `<summary>` is a
              leaf button to assistive technology, so a control nested in one is
              unreliably reachable and a live region inside it is swallowed into
              the disclosure's name. It also lands beside the empty state below,
              which is the case a sync most often fixes.

              It sits *inside* the lit window now rather than on the card body
              the window replaced, so it needs `relative` to clear the
              scanlines and a rule under it: the seat rows below draw their own
              dividers, and a key resting straight on the first of them reads as
              the lineup's own header row. */}
          <div className="relative border-b border-active/9 py-1.5">
            <LeagueSyncKey
              leagueId={league.league_id}
              leagueName={league.name}
              onSynced={onSynced}
            />
          </div>
          {entry ? (
            <LineupDetail entry={entry} />
          ) : (
            <p className="relative m-0 py-2.5 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
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
 * **The label sits outside the content cap and the value inside it.** The cap
 * is 132px, which is what keeps a four-tile row from stretching a figure across
 * a 1014px card; a label capped with it clips "Vs optimal" to "Vs opti…", and
 * the label is the one thing on the tile that cannot be inferred from what is
 * under it.
 *
 * The value switches on the cell's own state rather than on a boolean, so the
 * four tones stay four — see `MetricCell`. A **clear** draws the checkmark and
 * nothing else, which is why `cell.text` survives as the mark's `sr-only` name.
 */
function MetricTile({ label, cell }: { label: string; cell: MetricCell }) {
  return (
    <div
      className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.625rem] px-3 py-2.5`}
      title={cell.title}
    >
      <Scanlines />
      {/* Teal rather than the housing's foreground: on a housing the windows
          are the only lit surface, so a label in the metal's own colour would
          read as belonging to the metal rather than to the glass. */}
      <p className="relative m-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] text-readout-label">
        {label}
      </p>
      <div className="relative max-w-[8.25rem]">
        {cell.state === "clear" ? (
          <CheckMark text={cell.text} title={cell.title} />
        ) : (
          // Full opacity on every tone: the light-mode teal is only ~5:1
          // against the page, and an alpha drops it below AA.
          <p
            className={`m-0 mt-2 truncate font-mono text-[length:var(--fs-17)] leading-none tabular-nums ${
              cell.state === "alert"
                ? "text-error [text-shadow:0_0_12px_rgba(252,165,165,0.45)]"
                : cell.state === "count"
                  ? "text-readout [text-shadow:var(--readout-text-glow)]"
                  : // No answer at all: the muted ink and no glow, because a lit
                    // em dash reads as a reading rather than as its absence.
                    "text-readout-muted"
            }`}
          >
            {cell.text}
          </p>
        )}
      </div>
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

/** The lineup as set, seat by seat, then the bench. */
function LineupDetail({ entry }: { entry: LineupCheckLeague }) {
  return (
    <>
      <ul className="relative m-0 list-none p-0">
        {entry.lineup.map((seat, i) => (
          <SeatRow
            key={`${seat.slot}-${i}`}
            slot={seat.slot}
            player={seat.player}
            moveTo={seat.move_to}
            benched={seat.player ? entry.sit.includes(seat.player.player_id) : false}
          />
        ))}
      </ul>

      {entry.unknown_slots.length > 0 && (
        // A partial lineup must say so — see `unknown_slots` on the contract.
        <p className="relative m-0 py-2 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label">
          Not shown: {entry.unknown_slots.join(", ")}
        </p>
      )}

      {entry.bench.length > 0 && (
        <details className="group/bench relative">
          <summary className="flex h-[34px] cursor-pointer list-none items-center font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] text-readout-label transition-colors hover:text-readout">
            <span className="group-open/bench:hidden">
              Bench ({entry.bench.length}) ▸
            </span>
            <span className="hidden group-open/bench:inline">
              Bench ({entry.bench.length}) ▾
            </span>
          </summary>
          <ul className="m-0 list-none border-t border-active/9 p-0">
            {entry.bench.map((player) => (
              <SeatRow
                key={player.player_id}
                player={player}
                promoted={entry.start.includes(player.player_id)}
              />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function SeatRow({
  slot,
  player,
  moveTo,
  benched = false,
  promoted = false,
}: {
  slot?: string;
  player: LineupCheckLeague["lineup"][number]["player"];
  moveTo?: string | null;
  /** The optimal lineup sits him — a starter who should not be starting. */
  benched?: boolean;
  /** The optimal lineup starts him — a bench player who should be. */
  promoted?: boolean;
}) {
  const kickoff = player ? kickoffTime(player.kickoff) : null;

  return (
    <li className="relative flex h-[34px] items-center gap-2.5 border-b border-active/9 last:border-b-0">
      {slot !== undefined && (
        <span className="w-[34px] shrink-0 font-mono text-[length:var(--fs-11)] tracking-[0.12em] text-readout-label">
          {slotLabel(slot)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-[length:var(--fs-13)] text-readout-line">
        {player ? (player.name ?? player.player_id) : "Empty"}
        {/* A played game is not a recommendation the reader can act on, so it
            is marked rather than left to look like an oversight. */}
        {player?.locked && (
          <span className="ml-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.12em] text-readout-muted">
            <span className="sr-only">Locked — </span>
            <span aria-hidden>locked</span>
          </span>
        )}
      </span>

      {promoted && <Mark tone="active">start</Mark>}
      {benched && <Mark tone="error">sit</Mark>}
      {/* The seat kickoff order wants him in. Read off `move_to`, which the
          server derived with the same `kickoffMoves` the tile's count came
          from, so the badge and these marks cannot disagree. */}
      {moveTo && (
        <span
          className="shrink-0 font-mono text-[length:var(--fs-11)] font-medium tracking-[0.04em] text-active"
          title={`Kickoff order — seat him at ${slotLabel(moveTo)} and the more flexible slot stays open for the later game`}
        >
          <span className="sr-only">Re-seat at </span>
          <span aria-hidden>{"→ "}</span>
          {slotLabel(moveTo)}
        </span>
      )}

      {kickoff && (
        <span className="hidden shrink-0 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.1em] text-readout-muted sm:inline">
          {kickoff}
        </span>
      )}
      <span className="w-[46px] shrink-0 text-right font-mono text-[length:var(--fs-12)] tabular-nums text-readout">
        {/* Null is "the feed has no row for him" and reads as nothing; a real
            projected zero reads as `0.0`. */}
        {player?.points == null ? "—" : player.points.toFixed(1)}
      </span>
    </li>
  );
}

function Mark({
  tone,
  children,
}: {
  tone: "active" | "error";
  children: string;
}) {
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[length:var(--fs-9)] uppercase tracking-[0.12em] ${
        tone === "active"
          ? "border-active/40 text-active"
          : "border-error/40 text-error"
      }`}
    >
      {children}
    </span>
  );
}
