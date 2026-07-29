"use client";

import { useState } from "react";

import { formatPoints, formatRecord, formatValue, formatWeekRange } from "../format";
import type { LeagueKtcValue, ManagerLeague, ProjectedRank } from "../types";
import { LeagueDetailPanel } from "./league-detail-panel";

export function LeagueCard({
  league,
  rank,
  weeks,
  value,
  valuedAt,
}: {
  league: ManagerLeague;
  /**
   * Where this manager sits when the league's teams are ordered by projected
   * points — null while the ranks are loading, and for a league that can't be
   * ranked (nothing projected yet, or no roster held there). The chip simply
   * isn't shown then: an absent bonus, not an error.
   */
  rank: ProjectedRank | null;
  /** The horizon behind `rank`, so the chip can say what its number covers. */
  weeks: number[];
  /**
   * What this manager's roster here is worth on KeepTradeCut — null while the
   * values are loading, and for a league they hold no roster in. Absent rather
   * than zeroed, on the same terms as `rank`.
   */
  value: LeagueKtcValue | null;
  /** When those values were scraped, so the chip can say how old they are. */
  valuedAt: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <li className="rounded-xl border border-foreground/10 bg-foreground/[0.02] transition-colors hover:border-foreground/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 rounded-xl p-4 text-left hover:bg-foreground/[0.02]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Chevron open={expanded} />
            <h3 className="truncate text-lg font-semibold">{league.name}</h3>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-6">
            {league.record && (
              <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm font-medium tabular-nums text-foreground/80">
                {formatRecord(league.record)}
              </span>
            )}
            {rank && (
              <span
                title={`${formatPoints(rank.points)} projected · best lineup each week · ${formatWeekRange(weeks)}`}
                className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm text-foreground/55"
              >
                <span className="font-semibold tabular-nums text-foreground/85">
                  #{rank.rank}
                </span>{" "}
                of {rank.of} · proj
              </span>
            )}
            {value && <ValueChip value={value} valuedAt={valuedAt} />}
            <Stat value={league.total_rosters} label="teams" />
          </div>
        </div>
        <StatusBadge status={league.status} />
      </button>

      {expanded && (
        <div className="border-t border-foreground/10 py-4">
          <LeagueDetailPanel leagueId={league.league_id} />
        </div>
      )}
    </li>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-foreground/40 transition-transform ${
        open ? "rotate-90" : ""
      }`}
    >
      <path
        d="M7 5l6 5-6 5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * What this manager's roster in the league is worth on KeepTradeCut, and how
 * much of that value is in the best lineup rather than sat behind it.
 *
 * Three numbers rather than one because a total says nothing about shape: two
 * rosters worth 40k are not the same roster when one can start 30k of it and the
 * other is a deep bench propping up a thin lineup. The split is drawn from the
 * same lineup the expanded panel lists as Starters, so a chip and the card it
 * opens can't disagree about who starts, and IR and taxi land in the bench half
 * — value held that cannot be played is exactly what that half means.
 *
 * Nothing at all when the roster prices at nothing, on the same terms as the
 * rank chip beside it: KTC's board is skill players only and a pre-draft roster
 * is empty, so "0 ktc" would dress both up as a claim about the team.
 *
 * The label says *dynasty* because that is the only board this app scrapes —
 * these are keeper-asset prices, which is the wrong lens on the redraft leagues
 * in the same list, and worth naming rather than leaving to be inferred.
 */
function ValueChip({
  value,
  valuedAt,
}: {
  value: LeagueKtcValue;
  valuedAt: string | null;
}) {
  if (value.priced === 0) return null;

  const board = value.superflex ? "superflex" : "1QB";
  const title = [
    `${formatValue(value.total)} KeepTradeCut dynasty ${board} value`,
    value.split
      ? `${formatValue(value.split.starters)} in the best lineup, ${formatValue(
          value.split.bench,
        )} behind it`
      : "no projections yet, so nothing to split it across a lineup",
    `${value.priced} of ${value.rostered} rostered players priced`,
    valuedAt && `scraped ${new Date(valuedAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={title}
      className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm text-foreground/55"
    >
      <span className="font-semibold tabular-nums text-foreground/85">
        {formatValue(value.total)}
      </span>{" "}
      ktc
      {value.split && (
        <>
          {" · "}
          <span className="tabular-nums text-foreground/75">
            {formatValue(value.split.starters)}
          </span>{" "}
          start ·{" "}
          <span className="tabular-nums text-foreground/75">
            {formatValue(value.split.bench)}
          </span>{" "}
          bench
        </>
      )}
    </span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="rounded-md bg-foreground/5 px-2 py-0.5 text-sm text-foreground/55">
      <span className="font-semibold tabular-nums text-foreground/85">
        {value.toLocaleString()}
      </span>{" "}
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "border-active/40 text-active"
      : status === "drafting" || status === "pre_draft"
        ? "border-amber-400/40 text-amber-300"
        : "border-foreground/15 text-foreground/45";
  return (
    <span
      className={`mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide ${tone}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
