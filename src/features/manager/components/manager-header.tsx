import {
  useCallback,
  useId,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { Avatar } from "@/features/shared";

import { formatCountdown, formatRecord, formatWinPct } from "../format";
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
   * Those filters in words. With the controls in a modal this is the only thing
   * saying what the record is counted over, so it sits with the numbers rather
   * than on the button that opens them.
   */
  scope: string;
  /** How many leagues the filters leave — what `record.leagues` is out of. */
  leagueCount: number;
  /** The view's own headline count. */
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
    <header className="sticky top-[var(--site-header-h)] z-40 -mx-4 -mt-10 mb-6 flex flex-col gap-2 bg-[var(--background)] px-4 pb-4 pt-2">
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

        <div className="relative flex items-center gap-3 py-3 pl-5 pr-4 sm:gap-4 sm:py-4 sm:pl-6 sm:pr-5">
          <Avatar
            url={user.avatar_url}
            name={user.display_name || user.username}
            size="lg"
          />

          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <h1 className="min-w-0 truncate font-display text-base font-semibold tracking-tight sm:text-xl">
                {user.display_name || user.username}
              </h1>
              <span className="flex-none rounded-[5px] bg-active/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-active/80">
                {season}
              </span>
            </div>
            <RecordLine
              record={record}
              leagueCount={leagueCount}
              season={season}
            />
            <RecordBar record={record} />
          </div>

          <WinPctGauge pct={record.pct} />
        </div>

        <div className="relative flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-foreground/10 px-5 py-2.5 text-[11px] sm:px-6">
          <StatLine {...stat} />
          <Dot />
          <span className="text-foreground/35">
            <span className="text-foreground/25">Counting</span> {scope}
          </span>
          {refreshing && <RefreshingPill progress={progress} />}
          {summary && summary.failed > 0 && (
            <Warning>{summary.failed} failed to sync</Warning>
          )}
          {refreshError && <Warning>Refresh failed — showing cached data</Warning>}
        </div>
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
    </header>
  );
}

/**
 * The record, and what it was counted over.
 *
 * A season that hasn't started still shows its `0-0`: the digits are a true
 * count of games played, so the guard against dressing preseason up as a season
 * of losses lives in the pct alone — null rather than zero, an em dash on the
 * dial, never `.000` — see {@link aggregateRecord}. Only "your filters left
 * nothing" keeps its own words, because a `0-0` counted over no records at all
 * would be quoting records that don't exist.
 *
 * The count rides here rather than in a stat cell of its own: `record.leagues`
 * is smaller than the list — Sleeper keeps a manager in `league_users` after
 * they stop holding a team — and a denominator that small is only honest beside
 * the number it divides. The countdown to the season's opening kickoff rides
 * here too: it is the *when* of the `0-0` changing, and it retires itself the
 * moment that stops being a question.
 */
function RecordLine({
  record,
  leagueCount,
  season,
}: {
  record: OverallRecord;
  leagueCount: number;
  season: string;
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
      {/* No separator between the two: at phone width the line can wrap — "No
          records in these leagues" is most of it — and a dot left hanging off
          the end of the first line reads as a typo. The weight and colour do
          the same job on one line or two. */}
      <span className="text-foreground/40">
        <span className="tabular-nums">{record.leagues}</span> of{" "}
        <span className="tabular-nums">{leagueCount}</span> league
        {leagueCount === 1 ? "" : "s"}
      </span>
      <KickoffCountdown season={season} />
    </p>
  );
}

/**
 * A live countdown to the season's opening kickoff, on the line the `0-0`
 * shares — the when of that record changing.
 *
 * The instant comes from Sleeper's schedule call ({@link useKickoff}); the NFL
 * calendar table's provisional date stands in only when Sleeper hasn't
 * scheduled the season, and nothing renders until that question settles —
 * appearing once with the right instant beats appearing twice with two. The
 * tick reads the viewer's own clock, because how long *they* wait is a fact
 * about their wall clock (the `todayIso` side of the two-todays rule), and it
 * starts only after mount, since server and client have no "now" they agree
 * on — the account store's hydration rule, applied to a clock. Past kickoff it
 * renders nothing rather than a zero: from then on the record digits are the
 * season's own story.
 */
function KickoffCountdown({ season }: { season: string }) {
  const scheduled = useKickoff(season);
  const kickoff =
    scheduled === undefined ? null : (scheduled ?? firstKickoff(season));
  const now = useTick(kickoff);

  if (kickoff === null || now === null || now >= kickoff) return null;

  return (
    <span className="text-foreground/40">
      Kickoff in{" "}
      <span className="font-mono tabular-nums text-foreground/55">
        {formatCountdown(kickoff - now)}
      </span>
    </span>
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
 * season — where a bare `.537` reads as another statistic. Pure SVG, so it
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
 * The view's own headline count, on the plate's state line rather than in a rail
 * of its own — it is one number with a label, and a rail is what two of them
 * needed.
 */
function StatLine({ label, value, sub }: HeaderStat) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.16em] text-foreground/40">
        {label}
      </span>
      <span className="font-mono text-[13px] font-semibold tabular-nums leading-none">
        {value}
      </span>
      {sub && <span className="text-foreground/35">{sub}</span>}
    </span>
  );
}

/** The separator between two facts on one line. */
function Dot() {
  return (
    <span aria-hidden="true" className="text-foreground/20">
      ·
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
