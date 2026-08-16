import { formatPoints } from "../../format";
import type { LeagueWeekView } from "./types";

/**
 * The bar every team in this league is measured against, on the leading end of
 * the panel's head band.
 *
 * **It is drawn only where the league plays one** — Sleeper's
 * `league_average_match`, which is most leagues' answer of no. `median` is null
 * everywhere else, so there is nothing here to draw rather than an em dash: an
 * em dash reports a hole in a number, and a league whose scoring never applies a
 * median has no number to be missing.
 *
 * **It belongs to the week and not to either half**, which is why it sits on the
 * band above them rather than in a roster heading. A median is the middle of the
 * *whole field*, so seating it on one side would say it was that side's — and on
 * a week panel there are two sides, either of which can be over or under it.
 *
 * **It states the bar and never the verdict.** The two headings under it carry
 * each team's own number in the same units, so which side of this they fall on
 * is a comparison the reader is already making a few pixels away, and a `W`
 * beside it would restate two numbers that are both on screen — the rule this
 * panel keeps having to relearn (the team plate that named the lit standings
 * row, the prose that named the two lists under it). The mark belongs where the
 * numbers are *not* on screen, which is the lineup checker's row.
 *
 * **The reading is the headings' reading**: the best lineups available, with the
 * lineups actually set on the hover. Comparing best against best is the
 * like-for-like question — `RosterHeading`'s own argument — and a median taken
 * over a different reading from the numbers beside it would be three figures on
 * one band that cannot be compared. The other half is what the week comes to
 * untouched, and it is the half the lineup checker's own mark is counted on, so
 * it travels rather than being dropped.
 */
export function WeekMedianBar({ weekView }: { weekView: LeagueWeekView }) {
  const median = weekView?.median ?? null;
  if (!median) return null;

  return (
    // `min-w-0` and no `ml-auto`: the trailing seat holds the far end (see
    // `LeagueSyncKey`), so this takes the leading one and gives way first if the
    // band ever runs out of room.
    <div className="flex min-w-0 items-center gap-1.5">
      {/* Named, because a bare number on a band beside a sync key is a number
          about nothing. The word is the app's smallest label type — the roster
          heading's own `vs` — since what has to be read here is the figure. */}
      <span
        aria-hidden="true"
        className="shrink-0 text-[0.5625rem] font-semibold uppercase tracking-[0.12em] text-foreground/40"
      >
        median
      </span>
      <span
        // The roster headings' own sentence, pluralised: this is that readout's
        // number at the field's grain, and one figure explained two ways is the
        // drift the shared reading exists to stop.
        title={
          `${formatPoints(median.optimal)} from the best lineups available` +
          ` · ${formatPoints(median.current)} as currently set`
        }
        className="lab-readout shrink-0 rounded px-1.5 py-px font-mono text-[0.6875rem] font-semibold leading-4 tabular-nums text-foreground/80"
      >
        <span className="sr-only">League median for the week: </span>
        {formatPoints(median.optimal)}
      </span>
    </div>
  );
}
