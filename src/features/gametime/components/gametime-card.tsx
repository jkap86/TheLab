"use client";

import { memo, type MouseEvent, type ReactNode } from "react";

import type { GametimeGame, GametimeLeague, ManagerLeague } from "@/shared/contract";
import {
  BubblingFlask,
  CardBilletRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  ExpandedPanel,
  LeagueBillet,
  LeagueConfigWindow,
  MarginBay,
  OutcomeChips,
  RampFigure,
  Scanlines,
  sharePercentile,
  StandingBay,
  StandingStrip,
} from "@/features/shared";

import { leagueLiveRecord, statusScope } from "../helpers/live-record";
import { LivePanes } from "./live-panes";

/**
 * One league's week, live, as an instrument housing.
 *
 * `LineupCheckCard` with the week's *result* in its windows where that card
 * puts its four checks, and deliberately the same object everywhere else: the
 * same housing, the same billet with the avatar lit in its bezel, the same
 * settings strip under it and the same standing strip under that — a reader
 * walking from the checker to here is looking at the same league, and the
 * numbers changing is the whole of what should differ. Every constraint that
 * card records — the clip in one decorative layer, `flex-1` in a flex `<li>`,
 * the named `group/card`, the `pointer-fine:` budget, `min-w-0` — is inherited
 * and is silent when broken; its module note carries the arguments.
 *
 * **Three windows: the score, the live projection, and how much of the week
 * is still in play.** Each is the manager's figure over the opponent's, which
 * is what a matchup is read for, and the standing strip beneath states the
 * two margins and the outcome they add up to — `Live` and `Med` as signed
 * margins, the week's games as chips, on `MarginBay`'s own rule that the
 * colour is the margin's size and the chip says which way it went.
 *
 * Hook-free, for `LineupCheckCard`'s reason, and `memo`'d for its reason:
 * this card re-renders on every frame the stream pushes, which on a live
 * Sunday is every twenty seconds, and every prop but `entry`, `open` and
 * `lit` is stable by construction.
 */
export const GametimeCard = memo(function GametimeCard({
  league,
  entry,
  board,
  pending = false,
  open,
  lit,
  onToggle,
}: {
  league: ManagerLeague;
  /** This league's week, once the read lands. Undefined while it is in flight. */
  entry?: GametimeLeague | null;
  /** The week's scoreboard by NFL team — the payload's, read by the seat rows. */
  board: Readonly<Record<string, GametimeGame>>;
  /** The page's read has not answered yet — see `LineupCheckCard`'s own prop. */
  pending?: boolean;
  open: boolean;
  lit: boolean;
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
}) {
  const mine = entry?.mine ?? null;
  const theirs = entry?.opponent ?? null;

  return (
    <li
      data-card={league.league_id}
      className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10"
    >
      <details
        open={open}
        data-lit={lit ? "" : undefined}
        className={`group/card ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col`}
      >
        <summary
          onClick={(event) => onToggle(league.league_id, event)}
          className={
            // `z-10` keeps the decorative layer under this header: a
            // `<details>` paints its `<summary>` from a UA slot that comes
            // before the slot holding its other children, so the span written
            // first above would otherwise paint over the billet — the manager
            // card's own finding, and its own note carries the argument.
            `lab-card-3d ${CONSOLE_CARD_SHELL} relative z-10 pb-[1.125rem] pt-[1.875rem] sm:pt-[2.125rem] group-open/card:pb-0 flex flex-1 group-open/card:flex-none cursor-pointer list-none flex-col font-mono ` +
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
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
          >
            <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
            <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100 pointer-fine:block" />
            <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-data-[lit]/card:opacity-80" />
            <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100" />
          </span>

          <CardBilletRow>
            <LeagueBillet name={league.name} avatarUrl={league.avatar_url} />
          </CardBilletRow>

          <CardRule />

          <div className="relative mt-3 flex flex-col items-stretch gap-2 sm:mt-3.5 pointer-fine:[transform:translateZ(18px)]">
            <LeagueConfigWindow league={league} />
            <LiveStrip entry={entry} />
          </div>

          {entry?.as_of === "current" && (
            <p className="relative mt-3 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/85 pointer-fine:[transform:translateZ(14px)]">
              Lineup as set now
            </p>
          )}

          {/* Three across at every width — a third of a phone card is ~105px,
              room for a figure and its unit where four tiles left 79. A direct
              child of the summary, so the `translateZ` survives. */}
          <div className="relative mt-2.5 grid grid-cols-3 gap-1.5 sm:gap-2 pointer-fine:[transform:translateZ(22px)]">
            <LiveWindow
              label="Score"
              scope={theirs ? `Theirs ${theirs.scored.toFixed(1)}` : mine ? "No opponent" : ""}
              figure={mine ? mine.scored.toFixed(1) : null}
              percentile={mine && theirs ? sharePercentile(mine.scored, [mine.scored, theirs.scored]) : null}
              unit="pts"
              title={
                mine
                  ? theirs
                    ? `Scored so far: ${mine.scored.toFixed(1)} against ${theirs.scored.toFixed(1)}`
                    : `Scored so far: ${mine.scored.toFixed(1)}`
                  : "No lineup read for this league this week"
              }
              pending={pending && !entry}
              phase={0}
            />
            <LiveWindow
              label="Live proj"
              scope={theirs ? `Theirs ${theirs.live.toFixed(1)}` : mine ? `Proj ${mine.projected.toFixed(1)}` : ""}
              figure={mine ? mine.live.toFixed(1) : null}
              percentile={mine && theirs ? sharePercentile(mine.live, [mine.live, theirs.live]) : null}
              unit="on course"
              title={
                mine
                  ? `On course for ${mine.live.toFixed(1)}, projected ${mine.projected.toFixed(1)} before kickoff${
                      theirs ? `; opponent on course for ${theirs.live.toFixed(1)}` : ""
                    }`
                  : "No lineup read for this league this week"
              }
              pending={pending && !entry}
              phase={1}
            />
            <LiveWindow
              label="In play"
              scope={mine ? statusScope(mine.status) : ""}
              figure={mine ? String(mine.status.live) : null}
              // The count is lit while anything is running and neutral at rest:
              // a zero here is a real answer, not a fault.
              percentile={mine ? (mine.status.live > 0 ? 100 : null) : null}
              unit="playing"
              title={
                mine
                  ? `${mine.status.live} starter${mine.status.live === 1 ? "" : "s"} playing, ${mine.status.done} done, ${mine.status.pending} to play`
                  : "No lineup read for this league this week"
              }
              pending={pending && !entry}
              phase={2}
            />
          </div>
        </summary>

        {/* No sync key on the panel's seam, where the checker card carries
            one: this page is a stream, so a press re-reading Sleeper by hand
            is a control for a page that reads once. */}
        <ExpandedPanel open={open} closing={open && !lit}>
          {entry ? (
            <LivePanes
              mine={entry.mine}
              opponent={entry.opponent}
              board={board}
              teamName={league.team_name}
            />
          ) : (
            <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
              No lineup read for this league this week
            </p>
          )}

          {entry && entry.unknown_slots.length > 0 && (
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
 * The week's live outcome as a milled strip: the two comparisons as signed
 * margins on the live projections, and the games they add up to as chips.
 *
 * `LineupCheckCard`'s `ProjectionStrip` over live figures. The same three
 * absences draw no strip at all — no opponent, and a league without a median
 * draws two bays rather than `Med —`, on that strip's own argument.
 */
function LiveStrip({ entry }: { entry?: GametimeLeague | null }) {
  const record = leagueLiveRecord(entry);
  if (!entry || !entry.opponent || !record) return null;

  return (
    <StandingStrip stretch>
      <MarginBay label="Live" mine={entry.mine.live} against={entry.opponent.live} />
      {entry.median !== null && (
        <MarginBay label="Med" mine={entry.mine.live} against={entry.median.live} />
      )}
      <StandingBay label="Rec" stretch>
        <OutcomeChips games={record.games} verb="On course for a" />
      </StandingBay>
    </StandingStrip>
  );
}

/**
 * One reading, as a lit window — `MetricTile`'s surface with a figure polished
 * in the ramp's hue rather than struck in the alert's red: a score is a
 * reading, not a fault, and its colour is where it stands against the figure
 * opposite (`sharePercentile`, the standings table's own scale). A null
 * percentile is the neutral, which is what a window with nothing to compare
 * against draws.
 *
 * The same two rooms as the checker's tile: name over scope and the figure on
 * a desktop, name, figure and unit on a phone, one node in two layouts.
 */
function LiveWindow({
  label,
  scope,
  figure,
  percentile,
  unit,
  title,
  pending,
  phase,
}: {
  label: string;
  scope: string;
  /** Null draws an em dash — no answer for this league. */
  figure: string | null;
  percentile: number | null;
  unit: string;
  title: string;
  pending: boolean;
  phase: number;
}) {
  return (
    <div
      className={`${CONSOLE_WINDOW} flex min-w-0 flex-col rounded-[0.625rem] px-[7px] py-2 sm:px-2 sm:py-2.5`}
      title={title}
    >
      <Scanlines />
      <div className="relative sm:min-h-[1.625rem]">
        <p className="m-0 truncate font-mono text-[length:var(--fs-9)] uppercase leading-[1.2] text-readout-line sm:text-[length:var(--fs-11)] sm:tracking-[0.1em]">
          {label}
        </p>
        <p className="m-0 mt-px hidden min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-10)] uppercase leading-[1.2] tracking-[0.12em] text-readout-label sm:block">
          {scope}
        </p>
      </div>

      <div className="relative mt-auto pt-2">
        {pending ? (
          <BubblingFlask size={30} phase={phase} label="Reading" />
        ) : (
          <p className="m-0 truncate font-mono text-[length:var(--fs-18)] font-medium leading-none tabular-nums sm:text-[length:var(--fs-24)]">
            {figure === null ? (
              <span className="text-readout-muted">—</span>
            ) : (
              <Polished percentile={percentile}>{figure}</Polished>
            )}
          </p>
        )}
      </div>

      <p className="relative m-0 mt-0.5 min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-9)] uppercase tracking-[0.1em] text-readout-label sm:hidden">
        {figure === null ? "" : unit}
      </p>
      <span className="sr-only">{title}</span>
    </div>
  );
}

/** The figure in the ramp's hue — `RampFigure`, which is the strip's polish. */
function Polished({ percentile, children }: { percentile: number | null; children: ReactNode }) {
  return <RampFigure percentile={percentile}>{children}</RampFigure>;
}
