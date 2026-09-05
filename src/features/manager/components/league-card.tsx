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
  CardLedge,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_GLASS,
  CONSOLE_WINDOW,
  CONSOLE_WINDOW_LEDGE,
  ktcBoardLabel,
  LeagueChipRail,
  LedgeBay,
  LedgeFigure,
  LedgeName,
  LedgeWell,
  leagueType,
  LINEUP_METRIC_LABELS,
  MilledHairline,
  ordinal,
  ordinalParts,
  Scanlines,
} from "@/features/shared";

// Named by module path rather than through `@/features/shared`, and that is the
// whole reason the timeline sits outside that barrel: a component file is one
// module to the bundler, so a `TimelineView` reached through the barrel would
// ship the rail, the rewind and the fetch hook to every page importing anything
// shared — the trades board and the lineup checker among them, neither of which
// draws one. Named here, the chunk belongs to this route.
import { TimelineView } from "@/features/shared/ui/timeline";

import { rankColor, rankFill, rankPercentile } from "../helpers/lineup-metrics";


/**
 * One league, as an instrument housing that rises toward the viewer.
 *
 * **The card is a bezel with lit windows set into it**, not a pane of glass
 * with tiles floating on it — the same object a trade card is, which is the
 * whole point of the console-card language: a reader arriving from `/trades` or
 * `/lineupchecker` is looking at the same leagues, and the three cards should
 * read as one instrument seen from three tools.
 *
 * **The header is one milled billet, and that is the headline change.** It was
 * two plates in a row — the league on the left, its standing on the right —
 * competing for one line: the reading plate kept its width and the league's
 * name, which is the card's whole subject, truncated into whatever was left.
 * At a phone's width that was nine characters, and it had already cost the
 * points rank its place on the plate opposite to get there. Stacked into one
 * part the name has the full line and stops truncating, the standing drops into
 * a **well cut into the same billet** below it, and all three figures come back
 * at every width. See `CardLedge`.
 *
 * **Depth carries the hierarchy where a second pill used to.** That is the
 * whole argument for a billet rather than a plate: a plate is one face carrying
 * one thing, and a part chamfered on four edges is thick enough to hold a name
 * proud on its face and a recess beneath it.
 *
 * **The identity line under the rule became the league's settings, and they are
 * now four paired chips in a tray.** It used to read `team name · N-team ·
 * status`, which was one fact about the manager and two about the league, none
 * of them acted on; then a lit window carrying seven readings that wrapped
 * wherever the row ran out. `LeagueChipRail` pairs them into four parts — what
 * game, what scale, what QB shape, what TE shape — so nothing wraps ragged and
 * `TE prem` can never split from the ladder it qualifies. It reads every rule
 * off the same module the Filters dialog narrows by, so nothing is derived a
 * second time; the trades and lineup-checker cards keep the window arrangement
 * of the same facts, which is a design this bundle does not cover.
 *
 * **Teal is spent in two places and no more** — the format lamp and a lit
 * ladder pip. The card's underglow, its scanlines and the glow under every
 * rank meter are gone with the redesign, and what is left of the old tile row
 * is a 2px hairline: a saturated bar throwing light under every figure on a
 * page of a hundred cards was the noisiest thing on any of them.
 *
 * The rise is real perspective, not a `translateY`: the `<li>` owns the
 * `perspective`, the card sits at `rotateX(2deg)` at rest and flattens to
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
 * `--card-freeze-top`, which is the rack's own height, the ledge's overhang and
 * a little breath — **the ledge is what has to clear the rack**, not the
 * housing, since it is the ledge the name is on. See that token.
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
 * The window row, per column count, spelled out so Tailwind sees each class it
 * must generate.
 *
 * The windows have the card's full width to themselves, so they take equal
 * shares of it and the row reads as one instrument strip across the card.
 *
 * **Four across at every width, phones included**, which reverses the two-up
 * fallback this row used to take below `sm`. What made a four-way split at 390
 * unreadable was the figure: the rank printed "2nd of 12", which needs ~86px at
 * 16px mono and cannot fit an equal quarter of a phone-width card. The
 * denominator has since come out of the window — it is one number for all four
 * ranks and is stated in the chip rail's `Teams` — so the figure is an ordinal
 * with its suffix demoted, and the strip is one row rather than two. A four-way
 * strip that wraps is what pushes the card past the fold on a phone.
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
  // Whether the ledge has a well cut into it, which decides how much of the
  // card's top the ledge occupies. See the padding note below.
  const standing = standingFields(league).length > 0;

  return (
    // The `perspective` makes each `<li>` its own stacking context, so a card
    // that rises cannot paint over the one after it in DOM order — the raise
    // has to be ordered here, on the grid item, rather than on the summary
    // inside it. Without this an open card sits *under* the card to its right,
    // which is the one moment the raise is most visible.
    <li className="relative flex pointer-fine:[perspective:2600px] hover:z-10 has-[details[open]]:z-10">
      {/* `min-w-0` is what lets the card shrink to a phone. The `<li>` is a
          row flex container, so its item takes `min-width: auto` and refuses
          to go below its own min-content — and the expanded half's two panes
          sit side by side at every width by design, which puts that
          min-content above 390. Without this the card is wider than the
          viewport and the whole page scrolls sideways. */}
      <details className="group/card flex min-w-0 flex-1 flex-col">
        <summary
          className={
            `lab-card-3d ${CONSOLE_CARD_SHELL} flex flex-1 cursor-pointer list-none flex-col font-mono ` +
            // **The top padding is what clears the ledge**, which is a whole
            // two-line part hung off the card's edge rather than the single
            // plate that used to be: 88px on a phone and 100px above `sm`,
            // where a plate row needed 30. The gutter is 14px below `sm` and
            // 16 above, and the ledge's own insets are written to match at
            // each width — an absolutely positioned child resolves `left`
            // against the *padding box*, so a ledge written `left-0` would
            // overhang the chip rail beneath it by exactly the card's gutter.
            //
            // It composes the *shell* rather than appending to `CONSOLE_CARD`,
            // because two base `px-*` utilities of the same specificity are
            // decided by Tailwind's emit order — see that constant's note.
            "px-3.5 pb-3.5 sm:px-4 sm:pb-4 " +
            // **And it is two paddings, because the ledge is two heights.**
            // A league whose rosters have not been read has no standing to cut
            // a well for, so its ledge is the name line alone — 53px against
            // 106 at desktop, 45 against 93 at a phone — and the taller card's
            // padding left it floating over 76px of nothing. Both numbers are
            // the measured ledge less its overhang plus the same 14px of
            // breath, so the rule under the ledge sits the same distance below
            // it either way. The card cannot ask the ledge, which is
            // `absolute` and out of flow; it asks the same `standingFields`
            // the well is built from, so the two cannot disagree about which
            // ledge is being drawn.
            (standing
              ? "pt-[5.5rem] sm:pt-[6.25rem] "
              : "pt-10 sm:pt-[2.9375rem] ") +
            // **The open card's housing freezes under the rack.** See the note
            // below the component on why it is the `summary` and nothing else.
            "group-open/card:sticky group-open/card:top-[var(--card-freeze-top)] group-open/card:z-20 " +
            "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
            "pointer-fine:[transform:translateZ(0)_rotateX(2deg)] " +
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
            {/* Three layers, where there were four. `--card-specular` went with
                the glass — the housing draws its own top highlight in
                `--housing-shadow`'s first inset, and two of them is a bezel
                with a second, brighter bezel painted on it. The graticule floor
                and the accent underglow went with this pass: the floor exists
                to be foreshortened by a tilt and the glow was the third place
                the card spent teal, which is two more than the design allows
                it. What is left is the finish, the sheen and the edge light.

                The sheen only ever moves under a hover, so it stays out of the
                tree entirely on a coarse pointer rather than sitting there as a
                gradient nobody sees. */}
            <span className="absolute inset-0 bg-[image:var(--card-grain)] opacity-20" />
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute inset-x-[12%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-open/card:opacity-100" />
          </span>

          {/* The ledge is *not* inside the clipping layer: it straddles the
              card's top edge, and a clip is exactly what would cut it off. */}
          <CardLedge>
            <LedgeName name={league.name} avatarUrl={league.avatar_url} />
            <StandingWell league={league} />
          </CardLedge>

          <CardRule />

          {/* What game this league is playing, in place of the identity line
              that used to sit here. The team name and the status went with it —
              see `LeagueChipRail` — and the team count moved into it, where it
              is the scale the slot ladders are read against and the only place
              the card still states the field size the ranks below are out of. */}
          <LeagueChipRail
            league={league}
            className="mt-2 pointer-fine:[transform:translateZ(24px)]"
          />

          {/* The ranks get the row to themselves, under the rail rather than
              beside it — so the windows stay a direct child of the summary,
              which is what keeps their `translateZ` alive. A wrapper here would
              be a flat rendering context and the depth would silently go. */}
          <div
            className={`relative mt-1.5 grid gap-1.5 ${GRID_COLS[columns.length] ?? GRID_COLS[2]} pointer-fine:[transform:translateZ(12px)]`}
          >
            {columns.map((column) => (
              <RankWindow
                key={lineupColumnKey(column)}
                column={column}
                league={league}
                entry={entry}
              />
            ))}
          </div>

          {/*
            **The field size is stated once on this card, in the configuration
            window's `Teams`, and there used to be a second copy here.**
            `RankedOf` printed `Ranked of 12` under the strip — the same number
            as `Teams`, 40px above it, and the only right-aligned caption on a
            card where everything else is left. It is gone rather than moved:
            the window's field is the scale every count beside it is already
            read against, so the choice was between two spellings of one
            denominator and one, and the surviving one is the one with a
            vocabulary around it.

            The reading it *could* make and `Teams` cannot is a rank's own `of`
            — the rosters a metric could total, which is not always every seat —
            but that gap is a guard rather than a case (every metric ranks the
            same stored rosters), and a caption that is right about a case
            nobody has is not worth a second denominator on every card.
          */}
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
 * Record, standings rank and points rank, in the well cut into the ledge.
 *
 * **Three fields or as few as none**, and the absences are the point. A league
 * whose rosters have not been read has no record and no rank — nothing to
 * state — and the well is not cut at all, where drawing an empty one would read
 * as a rendering fault and drawing `0–0 · 1st` would be a claim. Each field
 * appears exactly when its own answer exists, so a league mid-way through its
 * first week can carry a record with no ranks behind it.
 *
 * **All three survive at every width now, and that is what the ledge bought.**
 * On the two-plate header the points rank came off below `sm`, because three
 * fields and their dividers were ~225px of a 322px row and the league name
 * opposite was left with four characters. Nothing is opposite the standing any
 * more — the name has the line above it — so the field that was dropped to buy
 * the card's own subject nine characters comes back.
 */
function standingFields(league: ManagerLeague): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  // **Rank leads, and the record follows it.** The standing is what the well is
  // read for — the record is how it was arrived at — so it takes the position a
  // reader's eye lands on first, at the well's own left edge, which is the
  // margin the name above and the chip rail below both share.
  if (league.standings_rank !== null) {
    fields.push({ label: "Rank", value: ordinal(league.standings_rank) });
  }
  if (league.record) {
    fields.push({ label: "Rec", value: formatRecord(league.record) });
  }
  if (league.points_rank !== null) {
    fields.push({ label: "Pts", value: ordinal(league.points_rank) });
  }
  return fields;
}

function StandingWell({ league }: { league: ManagerLeague }) {
  const fields = standingFields(league);
  if (fields.length === 0) return null;

  return (
    <LedgeWell>
      {fields.map((field, i) => (
        // The hairline is a sibling of the bays rather than a child of one, so
        // the well's own gap spaces all three evenly — nested, a cut would
        // carry the gap twice and sit twice as far from the bay beside it.
        <Fragment key={field.label}>
          {i > 0 && <MilledHairline />}
          <LedgeBay label={field.label}>
            <LedgeFigure>{field.value}</LedgeFigure>
          </LedgeBay>
        </Fragment>
      ))}
    </LedgeWell>
  );
}

/**
 * One rank column, as a lit window with its words stamped into a machined
 * header above the glass.
 *
 * **Both words live on the metal, and that is the hierarchy fix.** They used to
 * sit on the glass with the figure, where a caption and a number are peers
 * however they are sized — a reader scanning a strip of four had to read the
 * label to find the number. On two surfaces the caption is plainly a label for
 * the thing beneath it, and the glass holds the figure and its meter alone.
 *
 * **The suffix is demoted so the digit reads first**: a size down, a weight
 * lighter and at 55% opacity, which is what makes a page of cards scannable by
 * their numerals. The 11th–13th rule stays in `ordinalParts` rather than being
 * spelled again here — see that function.
 *
 * **The colour is the rank**, on the red -> neutral -> green ramp, and it is
 * driven by the same percentile as the meter's width so the bar and the hue
 * cannot disagree. It used to be the metric's *family* — accent for points,
 * `--metric-secondary` for capital — which told a reader the unit; the header
 * above the figure is what carries that now.
 *
 * **The meter is a 2px hairline with no glow on its fill**, where it was a 4px
 * bar throwing light in its own hue. On one card that read as an instrument; on
 * a hundred, four to a card, it was the noisiest thing on the page. It also
 * runs the window's full width rather than being capped at 88px, which the old
 * bar needed to keep from reading as a progress bar being filled — a hairline
 * does not.
 */
function RankWindow({
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
  const parts = rank ? ordinalParts(rank.rank) : null;

  return (
    <div className={`${CONSOLE_GLASS} min-w-0 rounded-xl`}>
      {/* **Stacked below `sm`, side by side above it**, which is a fit rather
          than a taste: an equal quarter of a phone-width card is ~79px of
          window and the two words cannot sit on one line in it. Stacked they
          are two truncating lines on the metal, which is where they belong
          either way. */}
      <div
        className={`${CONSOLE_WINDOW_LEDGE} px-1.5 py-[0.3125rem] sm:flex sm:items-baseline sm:justify-between sm:gap-2 sm:px-[0.6875rem] sm:py-[0.4375rem]`}
      >
        <p className="m-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.02em] text-[color:var(--billet-unit)] sm:text-[length:var(--fs-11)] sm:tracking-[0.07em]">
          {words.unit}
        </p>
        <p className="m-0 min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.06em] text-[color:var(--billet-scope)] sm:shrink-0 sm:tracking-[0.12em]">
          {tileScope(column, league)}
        </p>
      </div>

      <div className="px-1.5 pb-2 pt-2 sm:px-[0.6875rem] sm:pb-3 sm:pt-[0.8125rem]">
        {/* A computed colour, so it goes through `style` — the ramp is
            continuous and there is no utility class to generate for it. */}
        <p
          className="m-0 truncate font-display font-semibold leading-none tracking-[-0.025em] tabular-nums"
          style={{
            color: tone,
            textShadow: `0 0 20px ${rankColor(percentile, 0.4)}`,
          }}
        >
          <span className="text-[length:var(--fs-26)] sm:text-[length:var(--fs-32)]">
            {parts ? parts.figure : "—"}
          </span>
          {parts && (
            <span className="text-[length:var(--fs-12)] font-normal tracking-normal opacity-55 sm:text-[length:var(--fs-15)]">
              {parts.suffix}
            </span>
          )}
        </p>
        <span
          aria-hidden
          className="mt-2 block h-0.5 rounded-full bg-[color:var(--glass-meter-track)] sm:mt-[0.8125rem]"
        >
          <span
            className="block h-0.5 rounded-full"
            style={{ width: `${fill}%`, background: tone }}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * A window's second word: the scope for a projections or capital column, and the
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

