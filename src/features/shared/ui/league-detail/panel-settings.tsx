import { useMemo } from "react";

import { leagueScoringRows, leagueSettingRows } from "./league-settings";
import type { SettingRow } from "./league-settings";

/**
 * What this league is: what it pays for, beside how it is configured.
 *
 * The panel's other tab answers how the season is going; this one answers the
 * question a reader arrives at a *stranger's* league with, and which nothing in
 * the app said before — the trades board spans every crawled league, so "half
 * PPR or full", "is there a deadline", "how deep is the taxi squad" were
 * settings a card could hint at and never state.
 *
 * **Two columns of one material, because both are read and neither is acted
 * on.** Everywhere else in this panel the raised/recessed pairing is doing work
 * — the standings is the field you read and the roster the one you act on — and
 * there is no such split here, so making one up would say something untrue about
 * the halves. Both are troughs, which is also what "two similar columns" looks
 * like when the app's own grammar draws it.
 *
 * The 50/50 split holds at every width, the arrangement the two halves beside it
 * keep. What gives on a phone is the type and the insets rather than a column,
 * and the label is what truncates: a shortened `trade deadl…` beside a whole
 * `No deadline` still reads, where the reverse would leave a row with a name and
 * no answer.
 *
 * Each column scrolls on its own under a fixed heading, the panel's rule
 * throughout: a season's scoring blob is thirty-odd rows and the settings a
 * dozen, so the two lists run out at different points and scrolling them
 * together would carry one away in search of the other.
 */
export function PanelSettings({
  scoring,
  settings,
  teams,
  bestBall,
}: {
  /** This league's `scoring_settings` blob, as Sleeper stores it. */
  scoring: Record<string, number> | null;
  /** Its `settings` blob — everything but the three facts named below. */
  settings: Record<string, unknown> | null;
  /** How many rosters it holds, which the blob does not carry. */
  teams: number;
  /** Whether Sleeper seats the lineups, as the payload reports it. */
  bestBall: boolean;
}) {
  const scoringRows = useMemo(() => leagueScoringRows(scoring), [scoring]);
  const settingRows = useMemo(
    () => leagueSettingRows({ settings, teams, bestBall }),
    [settings, teams, bestBall],
  );

  return (
    <div className="grid min-h-0 grid-cols-2 grid-rows-[minmax(0,1fr)] gap-1.5 @lg:gap-4">
      <SettingsColumn
        title="Scoring"
        rows={scoringRows}
        empty="No scoring settings stored for this league."
        // The one thing the list cannot say about itself: that what is missing
        // from it is scored at nothing rather than unknown. It is also what
        // accounts for the column being short — a league stores a value for
        // every category Sleeper knows and pays for a fraction of them.
        note="Points per event · anything not listed pays nothing"
      />
      <SettingsColumn
        title="League"
        rows={settingRows}
        empty="No settings stored for this league."
      />
    </div>
  );
}

/**
 * One column: a fixed heading, a scrolling list of rows, and where it has one,
 * the fixed line saying what the list rests on.
 *
 * The heading and the note stay put for the standings' own reason — a list
 * scrolled past what names it is a column of unlabelled values — and the note
 * sits *outside* the scroll box rather than at the tail of it, because it
 * qualifies rows that are on screen the whole time.
 */
function SettingsColumn({
  title,
  rows,
  empty,
  note,
}: {
  title: string;
  rows: SettingRow[];
  /** What stands in when the league has nothing stored for this column. */
  empty: string;
  note?: string;
}) {
  return (
    <div className="lab-trough flex min-h-0 flex-col rounded-lg p-1 @lg:p-2">
      {/* `h3`, not `h4`: the league's name is this panel's `h2`, and the roster
          half's section titles are the same level for the same reason. */}
      <h3 className="shrink-0 truncate px-1 pb-2 pt-1 text-[0.7rem] font-semibold uppercase tracking-[0.08em] text-foreground/45 @lg:px-2 @lg:text-xs">
        {title}
      </h3>

      {rows.length === 0 ? (
        <p className="px-1 text-[0.7rem] leading-relaxed text-foreground/35 @lg:px-2">
          {empty}
        </p>
      ) : (
        // The bar rides in a lane of its own rather than over the values, half
        // of it paid for by bleeding into the trough's own inset — the two
        // halves' own arrangement, and see `.lab-scroll` for why the lane is
        // padding and not `scrollbar-gutter`.
        <ul className="lab-scroll -mr-1 flex min-h-0 flex-col overflow-y-auto overscroll-contain pb-0.5 pr-2">
          {rows.map((row) => (
            <SettingLine key={row.key} row={row} />
          ))}
        </ul>
      )}

      {note && rows.length > 0 && (
        <p className="shrink-0 px-1 pb-0.5 pt-2 text-[0.65rem] leading-relaxed text-foreground/35 @lg:px-2">
          {note}
        </p>
      )}
    </div>
  );
}

/**
 * One setting: what it is called, and what this league has it set to.
 *
 * The label track is the one that gives (`minmax(0,1fr)` against an `auto` value
 * column), because the value is the answer — a truncated `No deadlin…` would be
 * a row that has lost the only thing it was drawn for.
 *
 * `tabular-nums` on the value though most of them are words: the column is
 * scanned down and the numbers in it have to line up, and a named value is wide
 * enough that the figure face costs it nothing.
 */
function SettingLine({ row }: { row: SettingRow }) {
  return (
    <li
      title={row.title}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 px-1 py-[3px] @lg:px-2 @lg:py-1"
    >
      <span className="truncate text-[0.65rem] text-foreground/50 @lg:text-xs">
        {row.label}
      </span>
      <span className="text-right text-[0.7rem] font-medium tabular-nums text-foreground/85 @lg:text-[0.8125rem]">
        {row.value}
      </span>
    </li>
  );
}
