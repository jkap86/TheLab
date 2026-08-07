import type { ManagerHeaderProps } from "./manager-header.types.ts";
import { hasSyncState } from "./manager-header.utils.ts";
import { ManagerSummary } from "./manager-summary.tsx";
import { SeasonTab, StatTab } from "./plate-corners.tsx";
import { SyncStateLine } from "./sync-state.tsx";

/**
 * The padding under the plate's body, and around the transient state line.
 *
 * They were a function of whether a filters' key was seated in the corner: the
 * key's lit face had to be held clear of the readout above it — a narrowed key
 * glows and so does the countdown's running cell, and two lit faces a few pixels
 * apart read as one crowded part. With the key on the subject rail there is
 * nothing to clear, so both are the unencumbered spelling and the seam argument
 * lives here as history rather than as a branch.
 */
const BODY_PADDING = "pb-2 sm:pb-3";
const STATE_PADDING = "px-5 py-2 sm:px-6";

/**
 * Who is being looked at, how their season is going, and the list's own header
 * pinned under it.
 *
 * **One plate, and its four corners are readouts.** It was one block stacking
 * identity, season, both control pills, a 108px dial, the record and two stat
 * cells — about 470px of a 700px phone before the first row of the list — then a
 * plate with a recessed dock under it, which fixed the stacking and left a ~50px
 * trough holding a single control. This card is pinned over the list, so that
 * trough was 50px of league rows covered for a part that is usually pressed once.
 *
 * The filters' key then spent a while machined into the plate's bottom-right
 * corner, and left. **What that move taught is worth keeping even though the seat
 * is gone**: three of these corners are facts, so the one control among them was
 * seated in the wrong company, and the row directly below — the subject rail — was
 * already a filter row with a hole at its leading end. So the key leads that row
 * on every page that draws one, the plate keeps its readouts, and the clearance
 * the key needed above it (the seam between a lit face and the dial) goes back to
 * the list this card is pinned over.
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
 * sync state and the record are the same facts on all of them; only `stat` and
 * `columns` differ, which is why they are props rather than three copies of this
 * card.
 *
 * **The lineup checker renders it too, which is why the card is in
 * `features/shared`.** What it swaps is the *aggregation* behind `record` — the
 * season so far there, the week ahead here — and the plate draws both the same
 * way because they are the same shape, counted by the same two rules (see
 * {@link aggregateRecord}). The one thing that aggregation changes on the card
 * is which instrument the readout slot wears: a projected week is a live number
 * before kickoff where a season record is not, so that page passes
 * `countdown={false}` and keeps the dial. What it brings none of is the leagues
 * stream's sync state, so those three props are optional and the transient line
 * is simply never drawn.
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
  columns,
  countdown = true,
  pinned = true,
}: ManagerHeaderProps) {
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
      className={`${
        // `relative` rather than nothing when it lets go: the fade below the
        // header is an `::after` on this box, and an unpositioned header would
        // hand it to whatever ancestor happens to be positioned instead.
        pinned ? "sticky top-[var(--site-header-h)]" : "relative"
      } z-40 -mx-4 -mt-10 flex flex-col gap-1.5 bg-[var(--background)] px-4 pt-1.5 after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-16 after:bg-gradient-to-b after:from-[var(--background)] after:to-transparent ${
        columns ? "mb-3 pb-1.5" : "mb-6 pb-3"
      }`}
    >
      {/* The plate keeps `overflow-hidden`: the accent rail and the specular
          sweep are square boxes drawn against its rounded corners. The wrapper
          around it is what a part seated *outside* that clip would need — the
          filters' key used to be one, and the wall that made it read as
          pressable is exactly what the clip would have cut off. Nothing is
          seated there now (the key leads the subject rail below), so the wrapper
          is a plain positioning box. */}
      <div className="relative">
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

          <SeasonTab season={season} />
          <StatTab stat={stat} />

          <ManagerSummary
            user={user}
            season={season}
            record={record}
            scope={scope}
            leagueCount={leagueCount}
            countdown={countdown}
            padding={BODY_PADDING}
          />

          {hasSyncState({ refreshing, summary, refreshError }) && (
            <SyncStateLine
              refreshing={refreshing}
              progress={progress}
              summary={summary}
              refreshError={refreshError}
              padding={STATE_PADDING}
            />
          )}
        </div>
      </div>

      {columns}
    </header>
  );
}
