import type { RosterPick } from "@/shared/contract";

import { CONSOLE_BILLET, CONSOLE_WINDOW_LEDGE } from "../console-chrome";
import { ordinal } from "../format";

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
 * **The KeepTradeCut price rides the pill, and an unpriced pick shows nothing
 * rather than a dash.** This is one place the app's usual three-way grammar
 * gives way, and it is a density argument rather than an exception to the rule:
 * a portfolio is a dozen pills three words wide, and a column of em dashes
 * across the seasons KTC has no opinion about would be more ink than the picks
 * themselves. The claim a dash exists to prevent — that an unpriced pick is
 * worth nothing — is not available to make here, because there is no zero on
 * screen to mistake it for. `ktc_picks` on the card is the number that *is*
 * summed, and it is the one that owes the reader that distinction.
 *
 * **Each season is a part rather than a plate**, on the grammar the panes above
 * it took: milled stock, a ledge carrying the year, and the pills in a tray cut
 * into the face below. The rule that used to separate this block from the table
 * went with it — a housing does not need a line drawn across it to say where one
 * part ends and the next begins.
 *
 * Renders nothing when the roster owns no picks — every redraft league, and
 * any dynasty whose pick market this sync can't see. There is no empty state
 * for "the pick market here is quiet". Hook-free, like the card it sits in.
 *
 * **It moved here from `features/manager/components` when the timeline became a
 * second reader** — the line `CONSOLE_KEY`, `ManagerPlate` and
 * `LeagueConfigWindow` all moved on. That reader draws a *rewound* portfolio, so
 * two of the three fields on its pills are null by construction: see
 * `timelinePickAssets` for why a past moment can state a round and not a slot,
 * and why it prices nothing. Nothing here had to change for it, which is what
 * the three-way grammar above was for.
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
    <div className="mt-4 sm:mt-[1.125rem] pointer-fine:[transform:translateZ(3px)]">
      <p className="m-0 mb-2.5 font-mono text-[length:var(--fs-12)] uppercase tracking-[0.14em] text-foreground/70 lg:mb-3">
        Draft picks
      </p>
      {/* One column on a phone, three on a card wide enough to hold a season's
          pills without wrapping them to four lines. */}
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3 lg:gap-3">
        {bySeason.map(({ season, picks }) => (
          // **A season is a part, not a recessed plate.** It was
          // `--plate-bg` inside a lit window, which put a flat card on glass;
          // the expanded half is a housing holding parts now, so a season is
          // milled stock with its own ledge and its own tray — the same three
          // surfaces the panes above it are built from, at the size a handful
          // of pills wants.
          <li
            key={season}
            className={`${CONSOLE_BILLET} relative rounded-[0.875rem] p-[7px] lg:p-2`}
          >
            <p
              className={`${CONSOLE_WINDOW_LEDGE} relative m-0 rounded-lg px-[11px] py-1.5 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-[color:var(--billet-name)] [text-shadow:var(--billet-name-shadow)] lg:px-3`}
            >
              {season}
            </p>
            {/* The pills sit in a hole cut in the part, which is what makes
                them read as loose components in a tray rather than as chips
                printed on its face. */}
            <span className="relative mt-[7px] flex min-w-0 flex-wrap gap-1.5 rounded-[0.625rem] bg-[color:var(--recess-bg)] p-[7px] shadow-[var(--track-shadow)] lg:mt-2 lg:gap-[7px] lg:p-2">
              {picks.map((pick, i) => (
                <span
                  // Position in the sorted list is the identity the payload
                  // keeps — two acquired picks can share round *and* origin
                  // name, so nothing on the pick itself is unique.
                  key={i}
                  title={pick.from ? `from ${pick.from}` : undefined}
                  className={`inline-flex items-baseline gap-[7px] rounded-full px-3 py-1.5 font-mono text-[length:var(--fs-12)] ${
                    pick.from
                      ? "bg-active/16 text-readout shadow-[var(--pick-pill-shadow-lit)] [text-shadow:var(--readout-text-glow)]"
                      : "bg-foreground/[0.07] text-foreground/82 shadow-[var(--pick-pill-shadow)]"
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
                  {pick.value !== null && (
                    <span className="tabular-nums opacity-62">
                      {pick.value.toLocaleString("en-US")}
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
