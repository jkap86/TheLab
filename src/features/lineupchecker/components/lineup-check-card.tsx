import type { LineupCheckLeague, ManagerLeague } from "@/shared/contract";

import {
  gapCell,
  kickoffCell,
  kickoffTime,
  type MetricCell,
} from "../helpers/lineup-check-metrics";
import { LeagueSyncKey } from "./league-sync-key";

/**
 * One league's week, as a card that rises toward the viewer.
 *
 * The leagues console's card with a different pair of numbers in it, and
 * deliberately the same object: a reader arriving here from `/manager` is
 * looking at the same leagues, and two cards drawn to hold a league would be
 * two chances for one of them to drift.
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
 * `pointer-fine:`, because one card per league times ~6 composited planes each
 * is what kills an iOS Safari tab when a card opens. `LeagueCard` carries the
 * argument in full; the gate must stay on both, since this page renders the
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

  return (
    <li className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10">
      <details className="group/card flex flex-1 flex-col">
        <summary
          className={
            "lab-card-3d relative flex flex-1 cursor-pointer list-none flex-col rounded-[1.125rem] " +
            "border border-foreground/12 bg-[image:var(--card-bg)] px-[1.375rem] pb-[1.625rem] pt-7 " +
            "shadow-[var(--card-bevel),var(--card-lift)] " +
            "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
            "pointer-fine:hover:[transform:translateZ(30px)_rotateX(0deg)] " +
            "pointer-fine:group-open/card:[transform:translateZ(20px)_rotateX(0deg)] " +
            "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
            "hover:border-active/45 group-open/card:border-active/45 " +
            "pointer-fine:hover:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
            "pointer-fine:group-open/card:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >
          {/* Everything decorative, in the one layer that clips. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="absolute inset-x-0 top-0 h-[45%] bg-[image:var(--card-specular)]" />
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-open/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-open/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-open/card:opacity-100" />
          </span>

          <span className="relative text-balance bg-[image:var(--chrome-face)] bg-clip-text font-display text-[1.75rem] font-semibold leading-[1.06] tracking-[-0.04em] text-transparent transition-[filter] duration-[450ms] pointer-fine:[filter:var(--card-title-depth)] pointer-fine:[transform:translateZ(44px)] pointer-fine:group-hover/card:[filter:var(--card-title-depth-hover)]">
            {league.name}
          </span>

          <span
            aria-hidden
            className="relative mt-3.5 block h-px w-9 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] group-hover/card:w-[5.75rem] group-hover/card:from-active group-open/card:w-[5.75rem] group-open/card:from-active pointer-fine:[transform:translateZ(36px)]"
          />

          <p className="relative mt-[0.9375rem] font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60 pointer-fine:[transform:translateZ(14px)]">
            {league.team_name?.trim() || "—"}
            {` · ${league.total_rosters}-team`}
            {/* A lineup graded off the roster's *live* starters rather than the
                week's own stored ones has to say so — otherwise a stepped week
                shows today's lineup under that week's heading, which is the one
                claim this tool must not make silently. */}
            {entry?.as_of === "current" && (
              <span className="text-foreground/[0.78]"> · lineup as set now</span>
            )}
          </p>

          {/* A direct child of the summary, so the `translateZ` survives: a
              plain wrapper here is a flat rendering context and the depth would
              go with no error to say so. */}
          <div className="relative mt-5 grid grid-cols-2 gap-2.5 pointer-fine:[transform:translateZ(22px)]">
            <MetricTile label="Vs optimal" cell={gap} />
            <MetricTile label="Kickoff" cell={kickoff} />
          </div>
        </summary>

        {/* Outside the 3D context on purpose: a lineup table inside a
            `preserve-3d` subtree pays for a composited layer per row and gains
            nothing, since none of it is tilted. */}
        <div className="mt-3 rounded-[1.125rem] border border-foreground/10 bg-[image:var(--card-bg)] px-[1.375rem] pb-[1.375rem] pt-4 shadow-[var(--card-bevel)]">
          {/* Above the lineup rather than in the summary: a `<summary>` is a
              leaf button to assistive technology, so a control nested in one is
              unreliably reachable and a live region inside it is swallowed into
              the disclosure's name. It also lands beside the empty state below,
              which is the case a sync most often fixes. */}
          <LeagueSyncKey
            leagueId={league.league_id}
            leagueName={league.name}
            onSynced={onSynced}
          />
          {entry ? (
            <LineupDetail entry={entry} />
          ) : (
            <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
              No lineup read for this league this week
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/** One reading, as a lit window — the same surface as the console's readouts. */
function MetricTile({ label, cell }: { label: string; cell: MetricCell }) {
  return (
    <div
      className="relative min-w-0 overflow-hidden rounded-[0.625rem] border border-black/85 bg-[image:var(--readout-bg)] px-3 py-2.5 shadow-[var(--readout-shadow)]"
      title={cell.title}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />
      <p className="relative m-0 truncate font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
        {label}
      </p>
      {/* Full opacity on either tone: the light-mode teal is only ~5:1 against
          the page, and an alpha drops it below AA. */}
      <p
        className={`relative m-0 mt-2 truncate font-mono text-base leading-none tabular-nums ${
          cell.alert ? "text-error" : "text-readout"
        }`}
      >
        {cell.text}
      </p>
      <span className="sr-only">{cell.title}</span>
    </div>
  );
}

/** The lineup as set, seat by seat, then the bench. */
function LineupDetail({ entry }: { entry: LineupCheckLeague }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-black/85 bg-[image:var(--readout-bg)] px-3.5 py-1 shadow-[var(--readout-shadow)]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />

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
        <p className="relative m-0 py-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
          Not shown: {entry.unknown_slots.join(", ")}
        </p>
      )}

      {entry.bench.length > 0 && (
        <details className="group/bench relative">
          <summary className="flex h-9 cursor-pointer list-none items-center font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60 transition-colors hover:text-readout">
            <span className="group-open/bench:hidden">
              Bench ({entry.bench.length}) ▸
            </span>
            <span className="hidden group-open/bench:inline">
              Bench ({entry.bench.length}) ▾
            </span>
          </summary>
          <ul className="m-0 list-none border-t border-active/8 p-0">
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
    </div>
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
    <li className="relative flex h-8 items-center gap-2.5 border-b border-active/8 last:border-b-0">
      {slot !== undefined && (
        <span className="w-9 shrink-0 font-mono text-[0.6875rem] tracking-[0.12em] text-readout/60">
          {slotLabel(slot)}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-foreground/85">
        {player ? (player.name ?? player.player_id) : "Empty"}
        {/* A played game is not a recommendation the reader can act on, so it
            is marked rather than left to look like an oversight. */}
        {player?.locked && (
          <span className="ml-1.5 font-mono text-[0.625rem] uppercase tracking-[0.12em] text-foreground/45">
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
          className="shrink-0 font-mono text-[0.6875rem] font-bold tracking-[0.04em] text-active"
          title={`Kickoff order — seat him at ${slotLabel(moveTo)} and the more flexible slot stays open for the later game`}
        >
          <span className="sr-only">Re-seat at </span>
          <span aria-hidden>{"→ "}</span>
          {slotLabel(moveTo)}
        </span>
      )}

      {kickoff && (
        <span className="hidden shrink-0 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-foreground/60 sm:inline">
          {kickoff}
        </span>
      )}
      <span className="w-11 shrink-0 text-right font-mono text-[0.6875rem] tabular-nums text-readout">
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
      className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[0.5625rem] uppercase tracking-[0.12em] ${
        tone === "active"
          ? "border-active/40 text-active"
          : "border-error/40 text-error"
      }`}
    >
      {children}
    </span>
  );
}
