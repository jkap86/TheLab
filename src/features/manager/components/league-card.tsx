import { Fragment } from "react";

import type {
  LeagueLineupEntry,
  LeagueRecord,
  LineupMetricId,
  ManagerLeague,
} from "@/shared/contract";
import {
  CardPlateRow,
  CardRule,
  CONSOLE_CARD,
  CONSOLE_WINDOW,
  LeaguePlate,
  ordinal,
  PlateDivider,
  PlateField,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";

import {
  formatRank,
  LINEUP_METRIC_LABELS,
  rankColor,
  rankFill,
  rankPercentile,
} from "../helpers/lineup-metrics";
import { LeagueConfigWindow } from "./league-config-window";
import { LeagueTeams } from "./league-teams";

/**
 * One league, as an instrument housing that rises toward the viewer.
 *
 * **The card is a bezel with lit windows set into it**, not a pane of glass
 * with tiles floating on it — the same object a trade card is, which is the
 * whole point of the console-card language: a reader arriving from `/trades` or
 * `/lineupchecker` is looking at the same leagues, and the three cards should
 * read as one instrument seen from three tools.
 *
 * **The league's name moved from a headline into a plate**, which is the single
 * biggest change here. It used to be a 1.75rem `--chrome-face` engraving; it is
 * now a mono plate straddling the card's top edge with the league's avatar lit
 * in its bezel, and the plate opposite carries the three figures that used to
 * be scattered through the identity line and the status word: record, standings
 * rank, points rank.
 *
 * **The identity line under the rule became a configuration window.** It used
 * to read `team name · N-team · status`, which was one fact about the manager
 * and two about the league, none of them acted on; in its place is a lit window
 * stating what game the league is playing — format, lineup mode, superflex,
 * teams, starters, the QB+SF and TE ladders and the TE premium. See
 * `LeagueConfigWindow`, which reads every one of those off the rules the
 * Filters dialog narrows by rather than deriving any of them a second time.
 *
 * The rise is real perspective, not a `translateY`: the `<li>` owns the
 * `perspective`, the card sits at `rotateX(3deg)` at rest and flattens to
 * `translateZ(30px)` on hover, and the contents carry their own small
 * `translateZ` so the type separates from the housing as it comes forward. An
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
 *    child of the card. Do not move the clip onto the card. The same rule is
 *    why each tile's scanlines stay inside that tile, which they already do.
 * 2. The card must be `flex-1` inside a `flex` `<li>`, never `h-full`. A
 *    percentage height cannot resolve against an auto-sized grid row.
 *
 * The card stays hook-free, as before: the one interaction it owns is the
 * disclosure, and the state a card does need (which team, which metric) lives
 * in `LeagueTeams` below it.
 *
 * All of the depth — the perspective, `preserve-3d`, every `translateZ`, the
 * open-state lift/halo shadows — rides `pointer-fine:`, because its budget is
 * per-device rather than per-card: the stack is several composited planes *per
 * league*, with no virtualization, and iOS Safari's per-tab GPU budget dies on
 * it the moment a card opens ("a problem repeatedly occurred") where a desktop
 * never notices. The tilt is a pointer affordance anyway — it exists to be
 * flattened by a hover — so a coarse pointer gets the same card flat, with the
 * border accent, glow and edge light as its open affordance.
 * `lineup-check-card.tsx` carries the identical gate.
 */

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
  return (
    // The `perspective` makes each `<li>` its own stacking context, so a card
    // that rises cannot paint over the one after it in DOM order — the raise
    // has to be ordered here, on the grid item, rather than on the summary
    // inside it. Without this an open card sits *under* the card to its right,
    // which is the one moment the raise is most visible.
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
            {/* `--card-specular` is deliberately gone with the glass: it was a
                white wash over a translucent card, and the housing draws its own
                top highlight in `--housing-shadow`'s first inset. Two of them
                is a bezel with a second, brighter bezel painted on it.

                The sheen only ever moves under a hover, and the floor exists to
                be foreshortened by a tilt — neither has anything to say on a
                flat card, so both come out of the tree rather than sitting
                there as a gradient nobody sees. */}
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-open/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-open/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-open/card:opacity-100" />
          </span>

          {/* The plates are *not* inside the clipping layer: they straddle the
              card's top edge, and a clip is exactly what would cut them off. */}
          <CardPlateRow>
            <LeaguePlate name={league.name} avatarUrl={league.avatar_url} />
            <StandingPlate league={league} />
          </CardPlateRow>

          <CardRule />

          {/* What game this league is playing, in place of the identity line
              that used to sit here. The team name and the status went with it —
              see `LeagueConfigWindow` — and the team count moved into the
              window, where it is the scale the slot ladders are read against. */}
          <LeagueConfigWindow league={league} />

          {/* The ranks get the row to themselves, under the configuration
              rather than beside it — so the tiles stay a direct child of the
              summary, which is what keeps their `translateZ` alive. A wrapper
              here would be a flat rendering context and the depth would
              silently go. The margin is `mt-2.5` rather than `mt-4` because the
              window above already carries the separation the line did not. */}
          <div
            className={`relative mt-2.5 grid gap-2.5 ${GRID_COLS[columns.length] ?? GRID_COLS[2]} pointer-fine:[transform:translateZ(22px)]`}
          >
            {columns.map((id) => (
              <MetricTile key={id} id={id} entry={entry} />
            ))}
          </div>
        </summary>

        {/* The expanded half sits *outside* the 3D context on purpose: a table
            of twelve teams inside a `preserve-3d` subtree pays for a composited
            layer per row and gains nothing, since none of it is tilted. It is
            a lit window like every other reading on the card, rather than the
            second slab of glass it used to be. */}
        <div className={`${CONSOLE_WINDOW} mt-3 rounded-xl px-[1.125rem] pb-[1.125rem] pt-4`}>
          <Scanlines />
          <div className="relative">
            {entry && entry.teams.length > 0 ? (
              <LeagueTeams entry={entry} />
            ) : (
              <p className="m-0 font-mono text-[0.6875rem] uppercase tracking-[0.16em] text-readout-label">
                No rosters read for this league yet
              </p>
            )}
          </div>
        </div>
      </details>
    </li>
  );
}

/**
 * Record, standings rank and points rank, on one plate.
 *
 * **Three fields or as few as none**, and the absences are the point. A league
 * whose rosters have not been read has no record and no rank — nothing to
 * state — and the plate is not drawn at all, where drawing an empty one would
 * read as a rendering fault and drawing `0–0 · 1st` would be a claim. Each
 * field appears exactly when its own answer exists, so a league mid-way through
 * its first week can carry a record with no ranks behind it.
 */
function StandingPlate({ league }: { league: ManagerLeague }) {
  // `phone: false` is dropped below `sm` — see the note below.
  const fields: { label: string; value: string; phone: boolean }[] = [];
  if (league.record) {
    fields.push({ label: "Rec", value: formatRecord(league.record), phone: true });
  }
  if (league.standings_rank !== null) {
    fields.push({
      label: "Rank",
      value: ordinal(league.standings_rank),
      phone: true,
    });
  }
  if (league.points_rank !== null) {
    fields.push({ label: "Pts", value: ordinal(league.points_rank), phone: false });
  }
  if (fields.length === 0) return null;

  return (
    <ReadingPlate>
      {fields.map((field, i) => (
        // The divider is a sibling of the fields rather than a child of one, so
        // the plate's own gap spaces all three evenly — nested, a divider would
        // carry the gap twice and sit twice as far from the field beside it.
        //
        // **The points rank comes off the plate below `sm`**, which a render at
        // 390 forced rather than the handoff asking for it: three fields and
        // their dividers are ~225px of a 322px row, and the league plate
        // opposite is left with four characters — "D…" where the league name is
        // the card's whole subject. Dropping the third field gives it nine, and
        // the points rank is the one of the three a reader can most nearly
        // infer from the other two.
        <Fragment key={field.label}>
          {i > 0 && (
            <span className={field.phone ? undefined : "hidden sm:inline-flex"}>
              <PlateDivider />
            </span>
          )}
          <span className={field.phone ? undefined : "hidden sm:inline-flex"}>
            <PlateField label={field.label}>{field.value}</PlateField>
          </span>
        </Fragment>
      ))}
    </ReadingPlate>
  );
}

/**
 * One rank column, as a lit window with a meter under it.
 *
 * The window is the same surface as the console's readouts, which is what ties
 * a card's numbers back to the instrument around them — a figure on glass reads
 * as data, a figure on the housing reads as a label. The meter is what makes
 * "2nd of 12" comparable across cards at a glance; the text is what makes it
 * exact.
 *
 * **The colour is the rank**, on the red -> neutral -> green ramp, and it is
 * driven by the same percentile as the meter's width so the bar and the hue
 * cannot disagree. It used to be the metric's *family* — accent for points,
 * `--metric-secondary` for capital — which told a reader the unit; the label
 * above the figure is what carries that now.
 *
 * The label went teal with the redesign, and for a reason rather than for
 * decoration: on a housing the windows are the only lit surface, so a label
 * drawn in the housing's own foreground would read as belonging to the metal
 * rather than to the glass it is printed on.
 *
 * The glow under the fill is not decoration: a saturated bar sitting flat on
 * lit glass reads as paint, where the same bar throwing light reads as part of
 * the instrument. The figure takes the same glow in its own hue, which is what
 * makes it read as lit rather than as printed.
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
  // Not `fill`: that is 0 for last place *and* for nothing-to-rank, and only
  // the first of those is red. See `rankPercentile`.
  const percentile = rankPercentile(rank);
  const tone = rankColor(percentile);

  return (
    <div className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.625rem] px-3 py-2.5`}>
      <Scanlines />
      <p className="relative m-0 truncate font-mono text-[0.625rem] uppercase tracking-[0.14em] text-readout-label">
        {LINEUP_METRIC_LABELS[id].column}
      </p>
      {/* A computed colour, so it goes through `style` — the ramp is
          continuous and there is no utility class to generate for it. */}
      <p
        className="relative m-0 mt-2 truncate font-mono text-base leading-none tabular-nums"
        style={{
          color: tone,
          textShadow: `0 0 12px ${rankColor(percentile, 0.5)}`,
        }}
      >
        {formatRank(rank)}
      </p>
      <span
        aria-hidden
        className="relative mt-2.5 block h-1 rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
      >
        <span
          className="block h-1 rounded-full"
          style={{
            width: `${fill}%`,
            background: tone,
            boxShadow: `0 0 8px ${rankColor(percentile, 0.55)}`,
          }}
        />
      </span>
    </div>
  );
}
