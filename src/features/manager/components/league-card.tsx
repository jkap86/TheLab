import { Fragment } from "react";

import type {
  KtcBoardChoice,
  LeagueLineupEntry,
  LeagueRecord,
  LineupColumn,
  ManagerLeague,
} from "@/shared/contract";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { isKtcMetric, lineupColumnKey } from "@/shared/ktc/columns";
import { resolveKtcLineup } from "@/shared/ktc/roster";
import {
  CardPlateRow,
  CardRule,
  CONSOLE_CARD,
  CONSOLE_WINDOW,
  ktcBoardLabel,
  LeagueConfigWindow,
  leagueType,
  LeaguePlate,
  LINEUP_METRIC_LABELS,
  ordinal,
  PlateDivider,
  PlateField,
  ReadingPlate,
  Scanlines,
} from "@/features/shared";

// Named by module path rather than through `@/features/shared`, and that is the
// whole reason the timeline sits outside that barrel: a component file is one
// module to the bundler, so a `TimelineView` reached through the barrel would
// ship the rail, the rewind and the fetch hook to every page importing anything
// shared — the trades board and the lineup checker among them, neither of which
// draws one. Named here, the chunk belongs to this route.
import { TimelineView } from "@/features/shared/ui/timeline";

import {
  formatRank,
  rankColor,
  rankFill,
  rankPercentile,
} from "../helpers/lineup-metrics";


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
 * stating what game the league is playing — format, lineup mode, teams,
 * starters, the QB, SF and TE ladders and the TE premium. See
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
 * **An open card's housing pins under the rack while the browser scrolls past
 * it.** A twelve-team table is taller than the viewport, so a reader three
 * scrolls into one had nothing on screen saying which league they were reading
 * — the name is on a plate at the card's top edge and the top edge was gone.
 * Three variants and one token do it: `group-open/card:sticky` at
 * `--card-freeze-top`, which is the rack's own height plus a little breath.
 *
 * It has to be the **`<summary>`**, and the two obvious alternatives both fail
 * silently. The `<li>` is the whole card, expanded half included, and is taller
 * than the viewport — sticky on a box that never fits has nothing to stick
 * within. The `<details>` is the same box. The summary's sticky containing
 * block is the `<details>`, which is exactly the range the housing should stay
 * over: it parks when the card's top reaches the offset and releases when the
 * card's own bottom edge catches up with it, so it never outlives its league.
 *
 * The `z-20` is against the card's own expanded half rather than against the
 * rack, which is `z-50` and stays above it; the `<li>`'s existing
 * `has-[details[open]]:z-10` still orders the open card above its neighbours.
 * And the freeze depends on no ancestor gaining `overflow: hidden` — the
 * decorative clip is already scoped to its own absolutely-positioned span, for
 * the `preserve-3d` reason above, and that is now load-bearing twice.
 *
 * The card stays hook-free, as before: the one interaction it owns is the
 * disclosure, and the state a card does need lives below it — which team and
 * which metric in `LeagueTeams`, and where in the league's history the reader
 * is standing in `TimelineView`, which draws that browser over the rosters of
 * whichever moment the rail is on.
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
 * of it and the row reads as one instrument strip across the card.
 *
 * **Four across at every width, phones included**, which reverses the two-up
 * fallback this row used to take below `sm`. What made a four-way split at 390
 * unreadable was the figure: `formatRank` printed "2nd of 12", which needs
 * ~86px at 16px mono and cannot fit the 75px an equal quarter of a 326px card
 * gives it. The denominator has since come out of the tile — it is one number
 * for all four ranks, and it is stated once under the row and once more in the
 * configuration window's `Teams` — so the figure is an ordinal, the tile is
 * 75px, and the strip is one row rather than two. A four-tile strip that wraps
 * is what pushes the card past the fold on a phone.
 */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export function LeagueCard({
  league,
  columns,
  entry,
  season,
  username,
  board,
}: {
  league: ManagerLeague;
  /** The chosen rank columns, in canonical order — see `useLineupColumns`. */
  columns: readonly LineupColumn[];
  /** This league's solve + ranks, once the batched lineups read lands. */
  entry?: LeagueLineupEntry | null;
  /**
   * What a *past* stop is priced against — the same season, manager and market
   * the present table was solved on, so the two are one comparison rather than
   * two rulers. See `TimelineSubject`.
   */
  season: string | null;
  username: string;
  board: KtcBoardChoice;
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
            // **The open card's housing freezes under the rack.** See the note
            // below the component on why it is the `summary` and nothing else.
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
          <LeagueConfigWindow
            league={league}
            className="mt-3.5 pointer-fine:[transform:translateZ(18px)]"
          />

          {/* The ranks get the row to themselves, under the configuration
              rather than beside it — so the tiles stay a direct child of the
              summary, which is what keeps their `translateZ` alive. A wrapper
              here would be a flat rendering context and the depth would
              silently go. The margin is `mt-2.5` rather than `mt-4` because the
              window above already carries the separation the line did not. */}
          <div
            className={`relative mt-2.5 grid gap-2 ${GRID_COLS[columns.length] ?? GRID_COLS[2]} pointer-fine:[transform:translateZ(22px)]`}
          >
            {columns.map((column) => (
              <MetricTile
                key={lineupColumnKey(column)}
                column={column}
                league={league}
                entry={entry}
              />
            ))}
          </div>

          {/* The field size, once, for the whole strip. It came out of the
              tiles because it is one number for all four of them and a tile has
              75px to spend; it is stated here rather than only in the
              configuration window because a rank with no denominator anywhere
              near it is an ordinal without a scale. Read off the ranks
              themselves rather than `total_rosters` — a metric ranks the
              rosters it could total, which is not always every seat — and
              silent where the ranks do not agree on one, since a single caption
              over two field sizes would be a claim about both. */}
          <RankedOf columns={columns} entry={entry} />
        </summary>

        {/* The expanded half sits *outside* the 3D context on purpose: a table
            of twelve teams inside a `preserve-3d` subtree pays for a composited
            layer per row and gains nothing, since none of it is tilted. It is
            a lit window like every other reading on the card, rather than the
            second slab of glass it used to be. */}
        <div className={`${CONSOLE_WINDOW} mt-3 rounded-xl px-[1.125rem] pb-[1.125rem] pt-4`}>
          <Scanlines />
          <div className="relative">
            <TimelineView
              subject={{
                leagueId: league.league_id,
                season,
                username,
                board,
              }}
              entry={entry ?? null}
              // The reader's own team, so a past stop marks and ranks the same
              // team the present table does. Read off the payload the table is
              // drawn from, so the two cannot disagree; null while the lineups
              // read is in flight, which marks no team rather than the wrong one.
              managerRosterId={
                entry?.teams.find((t) => t.is_manager)?.roster_id ?? null
              }
            >
              <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
                No rosters read for this league yet
              </p>
            </TimelineView>
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
  // **Rank leads, and the record follows it.** The standing is what the plate
  // is read for — the record is how it was arrived at — so it takes the
  // position a reader's eye lands on first, nearest the card's own edge.
  if (league.standings_rank !== null) {
    fields.push({
      label: "Rank",
      value: ordinal(league.standings_rank),
      phone: true,
    });
  }
  if (league.record) {
    fields.push({ label: "Rec", value: formatRecord(league.record), phone: true });
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
  column,
  league,
  entry,
}: {
  column: LineupColumn;
  league: ManagerLeague;
  entry?: LeagueLineupEntry | null;
}) {
  const rank = entry?.ranks[lineupColumnKey(column)] ?? null;
  const fill = rankFill(rank);
  // Not `fill`: that is 0 for last place *and* for nothing-to-rank, and only
  // the first of those is red. See `rankPercentile`.
  const percentile = rankPercentile(rank);
  const tone = rankColor(percentile);
  const words = LINEUP_METRIC_LABELS[column.metric];

  return (
    <div className={`${CONSOLE_WINDOW} min-w-0 rounded-[0.625rem] px-2 py-2.5`}>
      <Scanlines />
      {/* **The min-height is on the block, not on either line**, and that is
          what holds every ordinal in the row on one baseline: a two-line label
          beside a one-line label would otherwise push its own figure down and
          the strip would read as four tiles at four heights. */}
      <div className="relative min-h-[1.5rem]">
        <p className="m-0 truncate font-mono text-[length:var(--fs-9)] uppercase leading-[1.2] tracking-[0.1em] text-readout-label">
          {words.unit}
        </p>
        <p className="m-0 mt-px min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-9)] uppercase leading-[1.2] tracking-[0.12em] text-readout [text-shadow:var(--readout-text-glow)]">
          {tileScope(column, league)}
        </p>
      </div>
      {/* A computed colour, so it goes through `style` — the ramp is
          continuous and there is no utility class to generate for it. */}
      <p
        className="relative m-0 mt-2 truncate font-mono text-[length:var(--fs-21)] font-medium leading-none tabular-nums"
        style={{
          color: tone,
          textShadow: `0 0 12px ${rankColor(percentile, 0.5)}`,
        }}
      >
        {formatRank(rank)}
      </p>
      {/* **Capped at 88px, where the label and the figure above take the tile's
          full width.** A meter that runs the whole of an equal quarter-card
          share reads as a progress bar being filled rather than as a gauge
          being read, and at one column it was a bar the width of the card. The
          cap is on the *track*, so the fill's percentage resolves against 88px
          and a full meter is 88px of gauge. It is deliberately not on the tile:
          the label has to keep the full width, which at 75px is every pixel it
          has. */}
      <span
        aria-hidden
        className="relative mt-[0.5625rem] block h-1 max-w-[5.5rem] rounded-full bg-[var(--meter-track)] shadow-[inset_0_1px_3px_rgba(0,0,0,0.95)]"
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

/**
 * A tile's second line: the scope for a projections or capital column, and the
 * board a KeepTradeCut column actually read for *this* league.
 *
 * **Resolved rather than echoed**, which is the difference between a reading
 * and a setting: a column left on `Auto` still priced against one market and
 * one QB board, and a tile that said "Auto" would leave the reader to work out
 * which — while the same two pure functions the route priced the number with
 * are right here, on a card that knows its own league. A second spelling of
 * either rule is a label naming a board the figure under it was not read on.
 */
function tileScope(column: LineupColumn, league: ManagerLeague): string {
  if (!isKtcMetric(column.metric)) {
    return LINEUP_METRIC_LABELS[column.metric].scope;
  }
  return ktcBoardLabel(
    // `leagueType` rather than a read of `settings.type`, on that helper's own
    // terms: Sleeper omits the field on a standard redraft league, and a second
    // copy of that fallback is a second chance to forget it — here it would be
    // a tile reading `Dyn` over a redraft league's number.
    resolveKtcFormat(column.format, leagueType(league)),
    resolveKtcLineup(column.lineup, league.roster_positions),
  );
}

/**
 * `Ranked of 12`, once, under the strip — or nothing at all.
 *
 * Suppressed while no column has a rank, because the caption would then be
 * describing a field nobody has been placed in; and suppressed where the
 * columns on screen do not agree on a field size, because one caption over two
 * of them would be wrong about one. In practice every metric ranks the same
 * stored rosters, so the disagreement arm is a guard rather than a case — which
 * is the point: it is the reading that cannot quietly become false.
 */
function RankedOf({
  columns,
  entry,
}: {
  columns: readonly LineupColumn[];
  entry?: LeagueLineupEntry | null;
}) {
  const sizes = new Set(
    columns
      .map((column) => entry?.ranks[lineupColumnKey(column)]?.of)
      .filter((of): of is number => of !== undefined),
  );
  if (sizes.size !== 1) return null;

  return (
    <p className="relative m-0 mt-2 text-right font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-readout-label">
      Ranked of {[...sizes][0]}
    </p>
  );
}
