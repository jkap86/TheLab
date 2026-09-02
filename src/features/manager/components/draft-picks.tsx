import type { RosterPick } from "@/shared/contract";

import { ordinal } from "../helpers/lineup-metrics";

/**
 * The roster's future draft picks, grouped by season — the season on the left,
 * its picks as chips on the right, because a portfolio is scanned season by
 * season ("what do I have in 2027?").
 *
 * A chip reads the way Sleeper names the pick: by its slot ("1.05") once that
 * draft's order is set, by its round ("2nd") before — and only then does an
 * acquired pick name its original owner, since a slot already says exactly
 * which pick this is. Acquired picks are tinted either way: a third party's
 * 1st is a different asset from your own, order or no order.
 *
 * Renders nothing when the roster owns no picks — every redraft league, and
 * any dynasty whose pick market this sync can't see. There is no empty state
 * for "the pick market here is quiet". Hook-free, like the card it sits in.
 */
export function DraftPicks({ picks }: { picks: readonly RosterPick[] }) {
  if (picks.length === 0) return null;

  // Picks arrive sorted by season, so a single pass groups them without a sort.
  const bySeason: { season: string; picks: RosterPick[] }[] = [];
  for (const pick of picks) {
    const last = bySeason.at(-1);
    if (last && last.season === pick.season) last.picks.push(pick);
    else bySeason.push({ season: pick.season, picks: [pick] });
  }

  return (
    <div className="mt-3 border-t border-foreground/10 pt-3">
      <span className="text-xs font-semibold tracking-wide text-foreground/60">
        Draft picks
      </span>
      <ul className="mt-1.5 flex flex-col gap-1.5">
        {bySeason.map(({ season, picks }) => (
          <li key={season} className="flex items-baseline gap-2">
            <span className="w-10 shrink-0 text-xs tabular-nums text-foreground/60">
              {season}
            </span>
            <span className="flex min-w-0 flex-wrap gap-1">
              {picks.map((pick, i) => (
                <span
                  // Position in the sorted list is the identity the payload
                  // keeps — two acquired picks can share round *and* origin
                  // name, so nothing on the pick itself is unique.
                  key={i}
                  title={pick.from ? `from ${pick.from}` : undefined}
                  className={`inline-flex items-baseline gap-1 rounded px-1.5 py-0.5 text-[11px] ${
                    pick.from
                      ? "bg-active/10 text-active"
                      : "bg-foreground/[0.06] text-foreground/70"
                  }`}
                >
                  {/* The zero-pad is what makes "1.05" read as a slot rather
                      than as a decimal — the spelling every league uses. */}
                  <span className="font-medium tabular-nums">
                    {pick.slot !== null
                      ? `${pick.round}.${String(pick.slot).padStart(2, "0")}`
                      : ordinal(pick.round)}
                  </span>
                  {pick.slot === null && pick.from && (
                    <span className="max-w-24 truncate">{pick.from}</span>
                  )}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
