import type { RosterPick } from "@/shared/contract";

import { ordinal } from "@/features/shared";

/**
 * The roster's future draft picks, grouped by season — one plate per season,
 * its picks as pills inside it, because a portfolio is scanned season by
 * season ("what do I have in 2027?").
 *
 * A pill reads the way Sleeper names the pick: by its slot ("1.05") once that
 * draft's order is set, by its round ("2nd") before — and only then does an
 * acquired pick name its original owner, since a slot already says exactly
 * which pick this is. Acquired picks are lit either way: a third party's 1st is
 * a different asset from your own, order or no order.
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
    <div className="mt-4 border-t border-foreground/10 pt-4">
      <p className="m-0 mb-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
        Draft picks
      </p>
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {bySeason.map(({ season, picks }) => (
          <li
            key={season}
            className="rounded-xl border border-foreground/8 bg-[image:var(--plate-bg)] px-3.5 py-3 shadow-[var(--plate-shadow)]"
          >
            <p className="m-0 mb-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-foreground/60">
              {season}
            </p>
            <span className="flex min-w-0 flex-wrap gap-1.5">
              {picks.map((pick, i) => (
                <span
                  // Position in the sorted list is the identity the payload
                  // keeps — two acquired picks can share round *and* origin
                  // name, so nothing on the pick itself is unique.
                  key={i}
                  title={pick.from ? `from ${pick.from}` : undefined}
                  className={`inline-flex items-baseline gap-1.5 rounded-full px-2.5 py-1 font-mono text-[0.6875rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] ${
                    pick.from
                      ? "bg-active/14 text-readout"
                      : "bg-foreground/[0.06] text-foreground/72"
                  }`}
                >
                  {/* The zero-pad is what makes "1.05" read as a slot rather
                      than as a decimal — the spelling every league uses. */}
                  <span className="tabular-nums">
                    {pick.slot !== null
                      ? `${pick.round}.${String(pick.slot).padStart(2, "0")}`
                      : ordinal(pick.round)}
                  </span>
                  {pick.slot === null && pick.from && (
                    <span className="max-w-24 truncate opacity-70">
                      {pick.from}
                    </span>
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
