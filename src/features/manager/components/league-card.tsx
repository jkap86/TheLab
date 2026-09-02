import type {
  LeagueLineupEntry,
  LeagueRecord,
  LineupMetricId,
  ManagerLeague,
} from "@/shared/contract";

import {
  formatRank,
  LINEUP_METRIC_LABELS,
  metricFillClass,
  metricToneClass,
  rankFill,
} from "../helpers/lineup-metrics";
import { LeagueTeams } from "./league-teams";

/**
 * One league, as a card that rises toward the viewer.
 *
 * The rise is real perspective, not a `translateY`: the `<li>` owns the
 * `perspective`, the card sits at `rotateX(3deg)` at rest and flattens to
 * `translateZ(30px)` on hover, and the contents carry their own small
 * `translateZ` so the type separates from the glass as it comes forward. An
 * **open** card is held flat, because a tilted card with a twelve-team table
 * inside it is unreadable — opening it is the end of the same motion hovering
 * starts.
 *
 * Two things that look optional are not, and both were found the hard way on
 * the tools page:
 *
 * 1. `transform-style: preserve-3d` cannot coexist with `overflow: hidden`,
 *    which forces a flat rendering context and silently collapses every child
 *    `translateZ`. So the decorative layers live inside one absolutely
 *    positioned wrapper that does the clipping, and the content stays a direct
 *    child of the card. Do not move the clip onto the card.
 * 2. The card must be `flex-1` inside a `flex` `<li>`, never `h-full`. A
 *    percentage height cannot resolve against an auto-sized grid row.
 *
 * The card stays hook-free, as before: the one interaction it owns is the
 * disclosure, and the state a card does need (which team, which metric) lives
 * in `LeagueTeams` below it.
 */

/**
 * Sleeper's `status`, as words rather than its own vocabulary.
 *
 * An unknown status falls through to the raw string rather than to a
 * placeholder: Sleeper adds them, and showing the one it sent is more use than
 * hiding it behind "unknown".
 */
const STATUS_LABELS: Record<string, string> = {
  pre_draft: "Pre-draft",
  drafting: "Drafting",
  in_season: "In season",
  complete: "Complete",
};

/** `8–5`, or `8–5–1` where the league has ties and this manager has one. */
function formatRecord(record: LeagueRecord): string {
  const base = `${record.wins}–${record.losses}`;
  return record.ties > 0 ? `${base}–${record.ties}` : base;
}

/**
 * The tile row, per column count, spelled out so Tailwind sees each class it
 * must generate.
 *
 * The tiles have the card's full width to themselves, so they take equal shares
 * of it and the row reads as one instrument strip across the card. Two across
 * on a phone is the exception: at 390 a four-way split is 70px a tile, which is
 * narrower than the rank it holds.
 */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

export function LeagueCard({
  league,
  columns,
  entry,
}: {
  league: ManagerLeague;
  /** The chosen rank columns, in canonical order — see `useLineupColumns`. */
  columns: readonly LineupMetricId[];
  /** This league's solve + ranks, once the batched lineups read lands. */
  entry?: LeagueLineupEntry | null;
}) {
  const status = STATUS_LABELS[league.status] ?? league.status;
  // Sleeper stores an unset team name as an empty string about as often as it
  // omits the key, so blank is folded in with null rather than rendered as one:
  // `?? "—"` alone leaves those cards with a silent gap where every other card
  // has a dash.
  const teamName = league.team_name?.trim() || null;

  return (
    // The `perspective` makes each `<li>` its own stacking context, so a card
    // that rises cannot paint over the one after it in DOM order — the raise
    // has to be ordered here, on the grid item, rather than on the summary
    // inside it. Without this an open card sits *under* the card to its right,
    // which is the one moment the raise is most visible.
    <li className="relative flex [perspective:2400px] hover:z-10 has-[details[open]]:z-10">
      <details className="group/card flex flex-1 flex-col">
        <summary
          className={
            "lab-card-3d relative flex flex-1 cursor-pointer list-none flex-col rounded-[1.125rem] " +
            "border border-foreground/12 bg-[image:var(--card-bg)] px-[1.375rem] pb-[1.625rem] pt-7 " +
            "shadow-[var(--card-bevel),var(--card-lift)] " +
            "[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "[transform:translateZ(0)_rotateX(3deg)] " +
            "hover:[transform:translateZ(30px)_rotateX(0deg)] " +
            "group-open/card:[transform:translateZ(20px)_rotateX(0deg)] " +
            "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
            "hover:border-active/45 group-open/card:border-active/45 " +
            "hover:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
            "group-open/card:shadow-[var(--card-bevel),var(--card-lift-hover),var(--card-halo-hover)] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >
          {/* Everything decorative, in the one layer that clips. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="absolute inset-x-0 top-0 h-[45%] bg-[image:var(--card-specular)]" />
            <span className="lab-anim absolute inset-y-0 left-0 w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%]" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-open/card:opacity-100" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-open/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-open/card:opacity-100" />
          </span>

          {/* The league name, engraved the same way as the plate but a size
              down. The gradient is clipped to the glyphs, so the depth is a
              drop-shadow filter rather than a text-shadow — and it comes from
              `--card-title-depth`, because `filter` does not compose across two
              declarations the way a `box-shadow` list does, which is why the
              hover glow is a whole second token rather than an addition. */}
          <span className="relative text-balance bg-[image:var(--chrome-face)] bg-clip-text font-display text-[1.75rem] font-semibold leading-[1.06] tracking-[-0.04em] text-transparent [filter:var(--card-title-depth)] [transform:translateZ(44px)] transition-[filter] duration-[450ms] group-hover/card:[filter:var(--card-title-depth-hover)]">
            {league.name}
          </span>

          {/* The accent rule: a short cyan hairline that extends on hover. */}
          <span
            aria-hidden
            className="relative mt-3.5 block h-px w-9 bg-gradient-to-r from-active/50 to-transparent transition-[width] duration-[450ms] [transform:translateZ(36px)] group-hover/card:w-[5.75rem] group-hover/card:from-active group-open/card:w-[5.75rem] group-open/card:from-active"
          />

          {/* The manager's own line. A league with neither a team name nor a
              record — one whose rosters have not been read — says only what it
              knows, rather than padding the line with a `0–0`. */}
          <p className="relative mt-[0.9375rem] font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60 [transform:translateZ(14px)]">
            {teamName ?? "—"}
            {league.record && (
              <>
                {" · "}
                <span className="tabular-nums text-foreground/[0.78]">
                  {formatRecord(league.record)}
                </span>
              </>
            )}
            {` · ${league.total_rosters}-team · ${status}`}
          </p>

          {/* The ranks get the row to themselves, under the identity rather
              than beside it — so the tiles stay a direct child of the summary,
              which is what keeps their `translateZ` alive. A wrapper here would
              be a flat rendering context and the depth would silently go. */}
          <div
            className={`relative mt-5 grid gap-2.5 ${GRID_COLS[columns.length] ?? GRID_COLS[2]} [transform:translateZ(22px)]`}
          >
            {columns.map((id) => (
              <MetricTile key={id} id={id} entry={entry} />
            ))}
          </div>
        </summary>

        {/* The expanded half sits *outside* the 3D context on purpose: a table
            of twelve teams inside a `preserve-3d` subtree pays for a composited
            layer per row and gains nothing, since none of it is tilted. */}
        <div className="mt-3 rounded-[1.125rem] border border-foreground/10 bg-[image:var(--card-bg)] px-[1.375rem] pb-[1.375rem] pt-4 shadow-[var(--card-bevel)]">
          {entry && entry.teams.length > 0 ? (
            <LeagueTeams entry={entry} />
          ) : (
            <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-foreground/60">
              No rosters read for this league yet
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/**
 * One rank column, as a lit window with a meter under it.
 *
 * The window is the same surface as the account readout, which is what ties a
 * card's numbers back to the console's own instruments — a figure on glass
 * reads as data, a figure on the card's plate reads as a label. The meter is
 * what makes "2nd of 12" comparable across cards at a glance; the text is what
 * makes it exact.
 */
function MetricTile({
  id,
  entry,
}: {
  id: LineupMetricId;
  entry?: LeagueLineupEntry | null;
}) {
  const rank = entry?.ranks[id] ?? null;
  const fill = rankFill(rank);

  return (
    <div className="relative min-w-0 overflow-hidden rounded-[0.625rem] border border-black/85 bg-[image:var(--readout-bg)] px-3 py-2.5 shadow-[var(--readout-shadow)]">
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[image:var(--readout-scanlines)]"
      />
      <p className="relative m-0 truncate font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
        {LINEUP_METRIC_LABELS[id].column}
      </p>
      {/* Full opacity on the tone: the light-mode teal is only ~5:1 against
          the page, and an alpha drops it below AA. */}
      <p
        className={`relative m-0 mt-2 truncate font-mono text-base leading-none tabular-nums ${metricToneClass(id)}`}
      >
        {formatRank(rank)}
      </p>
      <span
        aria-hidden
        className="relative mt-2.5 block h-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
      >
        <span
          className={`block h-1 rounded-full ${metricFillClass(id)}`}
          style={{ width: `${fill}%` }}
        />
      </span>
    </div>
  );
}
