import {
  useCallback,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Avatar } from "@/features/shared";

import {
  countdownSegments,
  formatCountdown,
  formatRecord,
  formatWinPct,
} from "../format";
import { useKickoff } from "../hooks/use-kickoff";
import { firstKickoff } from "../nfl-calendar";
import type { OverallRecord } from "../record";
import type { LeaguesResult, SyncProgress } from "../types";

/** A view's own headline count, shown on the plate's state line. */
export type HeaderStat = {
  label: string;
  value: ReactNode;
  /** The dim second line — usually what the count is out of. */
  sub?: ReactNode;
};

/**
 * Who is being looked at, how their season is going, and the two controls that
 * narrow it.
 *
 * **Two parts, not one card.** It was one block stacking identity, season, both
 * control pills, a 108px dial, the record and two stat cells — about 470px of a
 * 700px phone before the first row of the list, with the controls wrapping onto
 * their own lines because they shared a flex row with the season. So the parts
 * are separated by what they *are*: an identity plate carrying the account and
 * its record, and a control dock under it. They read as two parts because the
 * material says so — the plate is a milled face, the dock a recessed trough the
 * controls are seated in, the same raised/recessed grammar the app bar keeps.
 *
 * The plate absorbs the `Rostered` cell that used to stand on its own: how many
 * of the leagues on screen carry a record is the record's denominator, so it
 * belongs on the line with it rather than in a rail of its own (the rule
 * {@link aggregateRecord} states — a population-derived number travels with its
 * population).
 *
 * It carries no tabs, and neither does the bar any more: moving between Leagues,
 * Players and Leaguemates is three entries in the app bar's tools menu, which
 * already listed them. This card is pinned below that bar, so a row spent on
 * navigation is a row of the list it would cover.
 *
 * Every `/manager/[searched]/…` view renders this. The identity, the season, the
 * sync state and the record are the same facts on all of them; only `stat`
 * differs, which is why it is a prop rather than three copies of this card.
 */
export function ManagerHeader({
  user,
  season,
  refreshing,
  progress,
  summary,
  refreshError,
  record,
  scope,
  leagueCount,
  stat,
  filters,
  board,
  columns,
}: {
  user: LeaguesResult["user"];
  season: string;
  refreshing: boolean;
  progress: SyncProgress | null;
  summary: LeaguesResult["summary"];
  /**
   * A refresh that failed after cached data was already served. Shown as a
   * pill rather than replacing the page: what's below is stale, not wrong.
   */
  refreshError?: string | null;
  /** The manager's season summed over the leagues the filters leave. */
  record: OverallRecord;
  /**
   * Those filters in words, or null where they narrow nothing. A modal hides its
   * own state, so the selection is still repeated outside it — but only when
   * there *is* one: "counting all leagues" is the default describing itself, and
   * it sat on this card permanently for the sake of the rare case. Where it says
   * something it says it beside the record, which is the number it qualifies.
   */
  scope: string | null;
  /**
   * How many leagues the filters leave — what `record.leagues` is out of. It is
   * stated only where the two differ, since the usual case ("116 of 116") is a
   * denominator restating its own numerator.
   */
  leagueCount: number;
  /** The view's own headline count, worn as the plate's top-right corner tab. */
  stat: HeaderStat;
  /**
   * The filters' trigger. Omitted where a view has nothing to filter (e.g. a
   * manager with no leagues), which leaves the dock with nothing to seat and so
   * drops it entirely.
   */
  filters?: ReactNode;
  /**
   * The ADP board's trigger, beside the filters' own. Two controls rather than
   * two tabs of one dialog, because they narrow different populations — these
   * leagues against every crawled draft — and merging them would suggest one
   * selection where there are two.
   */
  board?: ReactNode;
  /**
   * The list's stat-column headings, laid on the cards' geometry.
   *
   * It rides in the header rather than at the top of the list for one reason:
   * this card is pinned, so anything inside it is pinned too, and a heading rail
   * that scrolls away halfway down a hundred-row list leaves the numbers under it
   * unlabelled. Sitting here it needs no offset of its own — measuring this
   * card's height to pin a sibling beneath it is the machinery not writing it
   * here avoids. It is outside the dock and outside the plate because it belongs
   * to neither: it is the list's own header, and it is laid out to line up with
   * the rows rather than with anything on this card.
   */
  columns?: ReactNode;
}) {
  return (
    // Pinned directly under the app bar, so who you are looking at and how their
    // season is going stay on screen while a several-hundred-row list scrolls
    // past. The bleed (`-mx-4 px-4`) and the opaque background are what the
    // header needs to cover that list rather than let it show through the gaps
    // around its rounded corners; `PageShell`'s `wide` gutter is the 4 they match.
    //
    // `-mt-10` cancels that same shell's `py-10` top padding, so the header's
    // resting place *is* its pinned one: without it the plate sat 40px lower
    // until the first scroll and then jumped up under the app bar, which reads
    // as the page shifting rather than as a card pinning.
    //
    // That opaque paint fades out below the header rather than ending, the same
    // `::after` the tools page's pinned plate carries and for the same reason: a
    // flat fill butted straight against the ambient aurora draws a hard
    // horizontal line across the page, so the glows look clipped at the header's
    // edge instead of passing behind a pinned surface. Fading also lets a league
    // card dim into the plate as it scrolls under rather than being cut mid-row.
    // `pointer-events-none` because it overhangs the list.
    //
    // The gap under it closes when the heading rail is riding here: the rail is
    // the list's own header, and 40px of background between a heading and the
    // first row it heads is what makes the two read as separate things. With the
    // rail absent the header is a card above a list and keeps the fuller gap.
    <header
      className={`sticky top-[var(--site-header-h)] z-40 -mx-4 -mt-10 flex flex-col gap-2 bg-[var(--background)] px-4 pt-2 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-gradient-to-b after:from-[var(--background)] after:to-transparent ${
        columns ? "mb-3 pb-2" : "mb-6 pb-4"
      }`}
    >
      <div className="relative isolate overflow-hidden rounded-2xl border border-foreground/10 bg-[linear-gradient(160deg,rgba(255,255,255,0.075),rgba(255,255,255,0.02)_60%,rgba(255,255,255,0.008))] shadow-[inset_0_1.5px_0_rgba(255,255,255,0.12),inset_0_-2px_8px_rgba(0,0,0,0.5),0_18px_40px_-22px_rgba(0,0,0,0.9)]">
        {/* The cyan rail down the plate, echoing the league rows' accent. */}
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 z-[2] w-1 bg-gradient-to-b from-active to-active/30 shadow-[0_0_16px_rgba(0,255,229,0.4)]"
        />
        {/* The specular sweep that reads as a milled face under a light. It is
            the plate's only decoration and sits under the content, not over it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(105deg,transparent_30%,rgba(255,255,255,0.06)_48%,transparent_62%)]"
        />

        {/* The two corner tabs, cut into the plate's top edge. They sit above the
            rail (`z-[3]` against its `z-[2]`), so the accent passes behind the
            left tab and resumes below it rather than stopping at the chip. */}
        <CornerTab side="left">
          <span className="font-mono text-[12px] font-bold leading-none tabular-nums text-active drop-shadow-[0_0_12px_rgba(0,255,229,0.35)]">
            {season}
          </span>
        </CornerTab>
        <CornerTab side="right">
          <span className="font-bold uppercase tracking-[0.12em] text-foreground/40">
            {stat.label}
          </span>
          <span className="font-mono text-[12px] font-bold leading-none tabular-nums text-foreground/85">
            {stat.value}
          </span>
          {stat.sub && <span className="text-foreground/35">{stat.sub}</span>}
        </CornerTab>

        {/* `pt` clears the tabs rather than the row being pushed below them: the
            avatar is the row's height either way, so the plate is exactly as tall
            as it was with both pills on the name line. */}
        <div className="relative flex items-center gap-3 pb-3 pl-5 pr-4 pt-[26px] sm:gap-4 sm:pb-4 sm:pl-6 sm:pr-5 sm:pt-7">
          <Avatar
            url={user.avatar_url}
            name={user.display_name || user.username}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            {/* The name has the line to itself now, so it truncates against the
                gauge rather than against two pills — which is what moving them
                to the corners was for. */}
            <h1 className="min-w-0 truncate font-display text-base font-semibold tracking-tight sm:text-xl">
              {user.display_name || user.username}
            </h1>
            <RecordLine
              record={record}
              scope={scope}
              leagueCount={leagueCount}
            />
            <RecordBar record={record} />
          </div>

          <HeaderReadout season={season} pct={record.pct} />
        </div>

        {/* The state line. It carries only what is transient — a refresh in
            flight, a sync that failed — so it is drawn only when there is
            something to say: with the countdown up in the readout slot, an
            always-present row would be an empty band under the record for the
            whole season. */}
        {(refreshing ||
          (summary && summary.failed > 0) ||
          refreshError) && (
          <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-foreground/10 px-5 py-2 text-[11px] sm:px-6">
            {refreshing && <RefreshingPill progress={progress} />}
            {summary && summary.failed > 0 && (
              <Warning>{summary.failed} failed to sync</Warning>
            )}
            {refreshError && (
              <Warning>Refresh failed — showing cached data</Warning>
            )}
          </div>
        )}
      </div>

      {/* The dock. A recessed trough rather than a second card, so the controls
          read as parts seated in the header rather than as more of the plate's
          content — and so the two of them can sit together without implying one
          selection, which is what a single dialog over both would suggest. It
          hugs what it holds (`w-fit`): a trough running the width of a desktop
          card with two chips at the left end is mostly empty slot. */}
      {(filters || board) && (
        <div className="lab-well lab-notch-lg flex w-fit max-w-full flex-wrap items-center gap-2 p-2">
          {filters}
          {board}
        </div>
      )}

      {columns}
    </header>
  );
}

/**
 * The record, and — only where it isn't the whole list — what it was counted
 * over.
 *
 * A season that hasn't started still shows its `0-0`: the digits are a true
 * count of games played, so the guard against dressing preseason up as a season
 * of losses lives in the pct alone — null rather than zero, an em dash on the
 * dial, never `.000` — see {@link aggregateRecord}. Only "your filters left
 * nothing" keeps its own words, because a `0-0` counted over no records at all
 * would be quoting records that don't exist.
 *
 * `record.leagues` can be smaller than the list — Sleeper keeps a manager in
 * `league_users` after they stop holding a team — and a denominator that small
 * is only honest beside the number it divides. But it usually *isn't* smaller,
 * and "116 of 116 leagues" is a denominator restating its numerator on a line
 * that has to stay short. So the shortfall is stated and the agreement is not:
 * the rule holds exactly where it means something. The count itself is up in the
 * plate's right corner tab, where it is a fact about the account rather than
 * about this record.
 */
function RecordLine({
  record,
  scope,
  leagueCount,
}: {
  record: OverallRecord;
  scope: string | null;
  leagueCount: number;
}) {
  return (
    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px] leading-snug">
      {record.leagues === 0 ? (
        <span className="text-foreground/55">No records in these leagues</span>
      ) : (
        <span className="font-mono font-semibold tabular-nums">
          {formatRecord(record)}
        </span>
      )}
      {/* No separator before it: at phone width the line can wrap and a dot left
          hanging off the end of the first line reads as a typo. The colour does
          the same job on one line or two. */}
      {scope && <span className="text-active/60">{scope}</span>}
      {record.leagues > 0 && record.leagues < leagueCount && (
        <span className="text-foreground/40">
          from <span className="tabular-nums">{record.leagues}</span> of{" "}
          <span className="tabular-nums">{leagueCount}</span> league
          {leagueCount === 1 ? "" : "s"}
        </span>
      )}
    </p>
  );
}

/**
 * The plate's right-hand readout: the countdown to kickoff while there is one,
 * the win-percentage dial once the season is running.
 *
 * They share the slot because they are never both worth drawing. Before kickoff
 * every league reports `0-0` and the dial is an em dash by rule — a win
 * percentage there is a claim about games nobody has played — while the clock is
 * the only moving number on the card; after kickoff the clock has nothing left
 * to count and the record is the season's own story. Giving the live one the
 * instrument is the same trade the plate already made when the season and the
 * headline count — both constants — went to its corner tabs.
 *
 * The two are the same box, so the swap costs the plate no height and the list
 * pinned under it does not jump when the season turns over. The dial is also
 * what stands in while the kickoff instant is still being resolved, which is
 * why nothing here renders a placeholder of its own.
 */
function HeaderReadout({ season, pct }: { season: string; pct: number | null }) {
  const scheduled = useKickoff(season);
  const kickoff =
    scheduled === undefined ? null : (scheduled ?? firstKickoff(season));
  const now = useTick(kickoff);

  if (kickoff === null || now === null || now >= kickoff)
    return <WinPctGauge pct={pct} />;

  return <KickoffCountdown msLeft={kickoff - now} />;
}

/**
 * A live countdown to the season's opening kickoff, drawn as a segment readout:
 * one milled cell per unit, the running unit lit, units labelled under their
 * digits.
 *
 * The cells are one row, never two. Wrapped into a 2×2 block they read as four
 * separate numbers rather than as one clock — the units run largest to smallest,
 * which is a left-to-right sentence, and breaking it after the hours puts the
 * minutes under the days. So the row sizes to its own contents (`w-fit`) and the
 * name beside it truncates instead, the same trade the plate already makes for
 * its corner tabs. It keeps the dial's *height* rather than its square, since the
 * two share the slot and the plate must not change height when the season turns
 * over.
 *
 * **The digits grew into that height rather than past it.** The readout was
 * ~40px of type inside a 68px box — the plate's one moving number set smaller
 * than the manager's name beside it — so the cells take the slack the box
 * already had: the whole group is still exactly the dial's height, and the plate
 * pinned over a several-hundred-row list covers the same amount of it as before.
 * Growing the *box* is the one move not available here, which is why the sizing
 * is written as type and padding inside a fixed height and not as a height of
 * its own.
 *
 * What the extra size buys is the material: at 12px a cell could only be a tinted
 * box, where at 26px it can be a machined lens (`.lab-readout`) with the running
 * unit's own housing lit rather than just its digit. The header rail is a
 * hairline and a tick rather than a bare caption, for the same reason — the
 * label of an instrument is part of the instrument.
 *
 * A cell's digits are padded ({@link countdownSegments}), so the readout ticks in
 * place; a cell is also floored at the width of two digits, so the days cell
 * doesn't narrow the row the day it drops from three digits to two. The row
 * narrows only when a unit empties for good.
 *
 * The cells are decoration to a screen reader — the digits are split across four
 * elements and would be read as four numbers — so the group carries
 * {@link formatCountdown}'s string as its label and the cells are hidden. The
 * two are one calculation, so they cannot drift.
 */
function KickoffCountdown({ msLeft }: { msLeft: number }) {
  const segments = countdownSegments(msLeft);

  return (
    <div
      className="grid h-[68px] w-fit flex-none content-center gap-1.5 sm:h-[78px]"
      aria-label={`Kickoff in ${formatCountdown(msLeft)}`}
    >
      {/* The label as a rail: a lit tick, the words, then a hairline running out
          to the right edge of the cells under it. A caption centred over the row
          floated; ruled across it, it reads as the instrument's own header. */}
      <span
        aria-hidden="true"
        className="flex items-center gap-1.5 text-[8px] font-bold uppercase leading-none tracking-[0.16em] text-active/70 sm:text-[9px]"
      >
        <span className="h-2 w-[2px] flex-none rounded-full bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]" />
        Kickoff in
        <span className="h-px flex-1 bg-gradient-to-r from-active/25 to-transparent" />
      </span>

      {/* The cells are tighter and a size down below `sm` for the one reason the
          plate keeps running into: the row shares a line with the manager's
          name, and this control growing is the name's width being spent. A
          phone gets the material and most of the size; a laptop gets all of
          it. */}
      <span aria-hidden="true" className="flex gap-[3px] sm:gap-1">
        {segments.map((segment, index) => {
          // The last cell is the one that is always moving, so it is the one
          // that is lit — housing included. Four lit cells read as a sign; one
          // reads as a clock that is running.
          const live = index === segments.length - 1;
          return (
            <span
              key={segment.unit}
              className={`flex-none rounded-[5px] px-1 pb-[3px] pt-[3px] text-center sm:px-1.5 ${
                live ? "lab-readout lab-readout-live" : "lab-readout"
              }`}
            >
              <span
                className={`block min-w-[1.35em] font-mono text-[19px] font-bold leading-[1.02] tabular-nums tracking-tight sm:text-[26px] ${
                  live
                    ? "text-active drop-shadow-[0_0_14px_rgba(0,255,229,0.55)]"
                    : "text-foreground/90 drop-shadow-[0_1px_0_rgba(0,0,0,0.6)]"
                }`}
              >
                {segment.value}
              </span>
              <span
                className={`mt-[1px] block text-[7px] font-bold uppercase leading-none tracking-[0.12em] ${
                  live ? "text-active/55" : "text-foreground/30"
                }`}
              >
                {segment.unit}
              </span>
            </span>
          );
        })}
      </span>
    </div>
  );
}

/**
 * The clock behind the countdown, as an external store — which a wall clock
 * is (`useSyncExternalStore`, the account store's shape). The snapshot is the
 * current *whole second*: it has to be stable within a render or reading it
 * would loop, and a countdown has no use for the milliseconds anyway. The
 * server snapshot is null — there is no "now" the two sides agree on, the
 * account store's hydration rule applied to a clock — so the timer appears
 * only after mount. The subscription starts nothing once `until` has passed,
 * and the interval retires itself when it does, so a header left open across
 * kickoff stops re-rendering a hidden timer.
 */
function useTick(until: number | null): number | null {
  const subscribe = useCallback(
    (onTick: () => void) => {
      if (until === null || Date.now() >= until) return () => {};
      const id = setInterval(() => {
        onTick();
        if (Date.now() >= until) clearInterval(id);
      }, 1000);
      return () => clearInterval(id);
    },
    [until],
  );

  return useSyncExternalStore<number | null>(
    subscribe,
    () => Math.floor(Date.now() / 1000) * 1000,
    () => null,
  );
}

/**
 * The same three numbers as proportion — where a .520 season and a .680 one are
 * told apart at a glance rather than by reading.
 *
 * An unplayed season keeps the empty rail rather than dropping it, so the plate
 * is the same height in September as in December: a card that pins itself under
 * the app bar can't change how much of the list it covers as the season turns
 * over.
 */
function RecordBar({ record }: { record: OverallRecord }) {
  const parts = [
    {
      key: "w",
      count: record.wins,
      tone: "bg-gradient-to-r from-active/50 to-active shadow-[0_0_10px_rgba(0,255,229,0.35)]",
    },
    { key: "l", count: record.losses, tone: "bg-foreground/[0.16]" },
    { key: "t", count: record.ties, tone: "bg-amber-400/50" },
  ];

  return (
    // The digits in `RecordLine` are the accessible reading of this; the bar is
    // the same three numbers as shape.
    // Capped rather than full-bleed: on a wide card the same three numbers
    // stretched a metre across the plate, which reads as a progress bar for
    // something rather than a proportion between two counts.
    <div aria-hidden="true" className="mt-2 flex h-[5px] max-w-[420px] gap-0.5">
      {record.games === 0 ? (
        <span className="block flex-1 rounded-sm bg-foreground/[0.07]" />
      ) : (
        parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <span
              key={part.key}
              className={`block rounded-sm ${part.tone}`}
              style={{ flexGrow: part.count }}
            />
          ))
      )}
    </div>
  );
}

/**
 * The win percentage as a dial.
 *
 * The number is the one figure on the plate that is a verdict rather than a
 * count, so it is drawn against the field it lives in — half the ring is a .500
 * season — where a bare `.537` reads as another statistic. It shares its slot
 * with the kickoff countdown ({@link HeaderReadout}), which is also why it keeps
 * its em-dash face rather than being dropped before a season starts: it is what
 * the plate shows while the kickoff instant is still resolving. Pure SVG, so it
 * renders on the server and stays out of the bundle; `useId` keeps the gradient
 * id unique in case two ever share a page.
 */
function WinPctGauge({ pct }: { pct: number | null }) {
  const gradientId = useId();
  // r=44 in a 100-unit box: circumference to the third decimal, so the arc lands
  // where the label says it does.
  const circumference = 2 * Math.PI * 44;

  return (
    <div className="relative grid h-[68px] w-[68px] flex-none place-items-center sm:h-[78px] sm:w-[78px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-active)" stopOpacity="0.45" />
            <stop offset="100%" stopColor="var(--color-active)" />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r="44"
          fill="none"
          strokeWidth="7"
          className="stroke-foreground/[0.07]"
        />
        {pct !== null && (
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            strokeWidth="7"
            strokeLinecap="round"
            stroke={`url(#${gradientId})`}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct)}
            className="drop-shadow-[0_0_6px_rgba(0,255,229,0.45)]"
          />
        )}
      </svg>
      <div className="flex flex-col items-center gap-0.5">
        <span
          className={`font-mono text-[15px] font-semibold leading-none tabular-nums tracking-tight sm:text-lg ${
            pct === null ? "text-foreground/35" : ""
          }`}
        >
          {formatWinPct(pct)}
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-foreground/40 sm:text-[9px]">
          Win pct
        </span>
      </div>
    </div>
  );
}

/**
 * A tab cut into one of the plate's top corners: what season is being read on
 * the left, the view's own headline count on the right.
 *
 * Both were pills on the identity line, where three things — the manager's name
 * and two constants — competed for one row's width and the *name* was what gave
 * way. They are facts about the whole card rather than about that line (which
 * season, how many leagues), so they read as well from its corners, and moving
 * them there costs the plate no height: the tabs sit in top padding the avatar's
 * own height already paid for.
 *
 * "Flush" is the whole of the styling. The outer corner takes the card's radius
 * one pixel in (`15px` against a `rounded-2xl` border), the two inner corners
 * are square but for a small return, and the fill is `lab-well` — the recessed
 * material the countdown cells wear — so a tab reads as machined out of the
 * plate's edge rather than as a chip parked near it. The left one pads past the
 * accent rail it covers.
 *
 * The right tab is a *slot*, not the league count: it renders whatever `stat`
 * each view passes, `sub` included ("of 121 total" is what the count is out of,
 * and a denominator separated from its numerator is the thing this card keeps
 * having to relearn).
 */
function CornerTab({
  side,
  children,
}: {
  side: "left" | "right";
  children: ReactNode;
}) {
  return (
    <span
      className={`lab-well absolute top-0 z-[3] inline-flex items-baseline gap-1.5 px-2.5 py-1 text-[10px] leading-none ${
        side === "left"
          ? "left-0 rounded-br-lg rounded-tl-[15px] pl-3.5"
          : "right-0 rounded-bl-lg rounded-tr-[15px]"
      }`}
    >
      {children}
    </span>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-amber-300">
      {children}
    </span>
  );
}

function RefreshingPill({ progress }: { progress: SyncProgress | null }) {
  const suffix =
    progress && progress.phase === "refresh" && progress.total > 0
      ? ` ${progress.loaded}/${progress.total}`
      : "…";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-active/30 bg-active/10 px-2.5 py-0.5 text-active">
      <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-active/40 border-t-active" />
      Refreshing{suffix}
    </span>
  );
}
