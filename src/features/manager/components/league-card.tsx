"use client";

import { useState } from "react";

import {
  formatPoints,
  formatRecord,
  formatValue,
  formatWeekRange,
} from "../format";
import type { LeagueKtcEntry, LeagueRankSet, ManagerLeague } from "../types";
import { LeagueDetailPanel } from "./league-detail-panel";
import { Chevron } from "./ui";

/**
 * One league in the leagues list: a dense, glassy row that reads at a glance and
 * opens the full standings-and-rosters panel on click.
 *
 * What the collapsed row is *for* is the four rankings across it — where this
 * manager stands by record, by points scored, by KTC starter value and by
 * projected points. Each is the same shape (`#N of M`) so they line up column to
 * column down the whole list, and each is tinted and metered by where in its
 * league it falls: near the top reads in the accent, near the bottom in rose,
 * the middle left in plain ink. The number is always the real read; the colour
 * is a second, faster one.
 *
 * The raw KTC total that used to sit on the row moves onto the KTC column's
 * hover, where the value, the board and the priced count still answer — the row
 * itself is kept to name, record and the four ranks.
 */
export function LeagueCard({
  league,
  ranks,
  weeks,
  ktc,
  valuedAt,
}: {
  league: ManagerLeague;
  /**
   * Where this manager sits by record, points for and projected points — null
   * while the ranks are loading, and each field independently null for a ranking
   * this league can't form yet (nothing projected, or nothing played). A missing
   * rank shows as a dim placeholder rather than a gap, so the columns stay put.
   */
  ranks: LeagueRankSet | null;
  /** The horizon behind the projected rank, so its hover can say what it covers. */
  weeks: number[];
  /**
   * This manager's KTC value here and its starter-value rank — null while
   * loading, and for a league they hold no roster in. Absent rather than zeroed,
   * on the same terms as `ranks`.
   */
  ktc: LeagueKtcEntry | null;
  /** When those KTC values were scraped, for the KTC column's hover. */
  valuedAt: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const record = league.record;
  const pointsRank = ranks?.points ?? null;
  const proj = ranks?.proj ?? null;
  const board = ktc?.superflex ? "superflex" : "1QB";

  return (
    <li className="group rounded-xl border border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-foreground/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_-16px_rgba(0,0,0,0.7)] backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_20px_44px_-18px_rgba(0,0,0,0.85)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full flex-col items-stretch gap-3 rounded-xl px-4 py-3 text-left sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Chevron open={expanded} size="md" />
          <StatusDot status={league.status} />
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
            {league.name}
          </h3>
          {record && (
            <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground/70">
              {formatRecord(record)}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-stretch divide-x divide-foreground/10">
          <RankStat
            label="Standing"
            rank={ranks?.standing ?? null}
            title={
              ranks?.standing
                ? `#${ranks.standing.rank} of ${ranks.standing.of} by record${
                    record ? ` · ${formatRecord(record)}` : ""
                  }`
                : "no standing yet"
            }
          />
          <RankStat
            label="Points"
            rank={pointsRank}
            title={
              pointsRank
                ? `#${pointsRank.rank} of ${pointsRank.of} by points for · ${formatPoints(
                    pointsRank.pointsFor,
                  )} pts`
                : "no points scored yet"
            }
          />
          <RankStat
            label="KTC start"
            rank={ktc?.starters_rank ?? null}
            title={ktcTitle(ktc, board, valuedAt)}
          />
          <RankStat
            label="Proj start"
            rank={proj}
            title={
              proj
                ? `#${proj.rank} of ${proj.of} by projected starters · ${formatPoints(
                    proj.points,
                  )} · best lineup each week · ${formatWeekRange(weeks)}`
                : "nothing left to project"
            }
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-foreground/10 py-4">
          <LeagueDetailPanel leagueId={league.league_id} />
        </div>
      )}
    </li>
  );
}

/** The hover text for the KTC column, where the raw value now lives. */
function ktcTitle(
  ktc: LeagueKtcEntry | null,
  board: string,
  valuedAt: string | null,
): string {
  if (!ktc || ktc.priced === 0) return "nothing priced on KeepTradeCut";
  return [
    ktc.starters_rank &&
      `#${ktc.starters_rank.rank} of ${ktc.starters_rank.of} by starter value`,
    ktc.split && `${formatValue(ktc.split.starters)} starting`,
    `${formatValue(ktc.total)} KeepTradeCut dynasty ${board} value`,
    `${ktc.priced} of ${ktc.rostered} rostered players priced`,
    valuedAt && `scraped ${new Date(valuedAt).toLocaleString()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

const TIER_TEXT: Record<Tier, string> = {
  hi: "text-active",
  mid: "text-foreground/85",
  lo: "text-rose-300",
};
const TIER_FILL: Record<Tier, string> = {
  hi: "bg-active",
  mid: "bg-foreground/40",
  lo: "bg-rose-400/80",
};

type Tier = "hi" | "mid" | "lo";

/**
 * Where a rank falls in its league as a fraction (1 for first, 0 for last), and
 * the tier that fraction lands in. The tiers are wide bands, not thirds, so the
 * accent is reserved for genuinely near the top and rose for genuinely near the
 * bottom — most rows read as the neutral middle, which is what keeps a card of
 * four colours from looking like an alarm.
 */
function rankTier(rank: { rank: number; of: number }): { p: number; tier: Tier } {
  const p = rank.of <= 1 ? 1 : (rank.of - rank.rank) / (rank.of - 1);
  const tier: Tier = p >= 0.62 ? "hi" : p <= 0.3 ? "lo" : "mid";
  return { p, tier };
}

/**
 * One ranked column: a label, `#N of M`, and a meter of where in the league that
 * sits. A null rank keeps the column — an em dash and an empty track — so a
 * loading or unrankable metric doesn't shift the ones beside it.
 */
function RankStat({
  label,
  rank,
  title,
}: {
  label: string;
  rank: { rank: number; of: number } | null;
  title: string;
}) {
  const t = rank ? rankTier(rank) : null;
  return (
    <div title={title} className="flex w-20 shrink-0 flex-col gap-1 px-2.5">
      <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-foreground/40">
        {label}
      </span>
      {rank && t ? (
        <span className="flex items-baseline gap-0.5 leading-none">
          <span className={`text-base font-bold tabular-nums ${TIER_TEXT[t.tier]}`}>
            #{rank.rank}
          </span>
          <span className="text-[11px] tabular-nums text-foreground/40">
            /{rank.of}
          </span>
        </span>
      ) : (
        <span className="text-base font-bold leading-none text-foreground/25">
          —
        </span>
      )}
      <span className="h-1 w-full overflow-hidden rounded-full bg-foreground/10">
        {rank && t && (
          <span
            className={`block h-full rounded-full ${TIER_FILL[t.tier]}`}
            style={{ width: `${Math.max(6, t.p * 100)}%` }}
          />
        )}
      </span>
    </div>
  );
}

/**
 * A small state dot standing in for the old text badge: the accent for a league
 * in season, amber for one still drafting, dim for anything done. The status
 * word rides on hover and for screen readers.
 */
function StatusDot({ status }: { status: string }) {
  const tone =
    status === "in_season"
      ? "bg-active shadow-[0_0_8px_rgba(0,255,229,0.7)]"
      : status === "drafting" || status === "pre_draft"
        ? "bg-amber-300 shadow-[0_0_8px_rgba(252,211,77,0.6)]"
        : "bg-foreground/30";
  return (
    <span title={status.replace(/_/g, " ")} className="flex shrink-0 items-center">
      <span className={`h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
      <span className="sr-only">{status.replace(/_/g, " ")}</span>
    </span>
  );
}
