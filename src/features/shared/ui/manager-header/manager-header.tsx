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
 * already listed them.
 *
 * **It scrolls away, and only the list's heading rail stays.** This card was
 * pinned under the app bar and the filter row and the heading rail rode inside
 * it, so all three held the top together — which is a card's worth of facts
 * about the account on screen permanently, paid for out of the list, to keep four
 * column headings from scrolling off. The account, the season and the record are
 * read once at the top of the page; what a reader still needs at row ninety is
 * the names of the columns they are scanning. So the rail pins itself now (see
 * {@link ListLedge}) and this is an ordinary card above the list — which is also
 * why it paints no ground, bleeds to no gutter and fades into nothing: every one
 * of those existed to cover a list scrolling underneath it.
 *
 * It renders neither the filter row nor that rail any more, for the reason it can
 * no longer render either: a sticky part travels only as far as its own parent's
 * box, so a rail seated in this card would scroll away inside it. Both are the
 * page's own children, beside the rows they belong to.
 *
 * Every `/manager/[searched]/…` view renders this. The identity, the season, the
 * sync state and the record are the same facts on all of them; only `stat`
 * differs, which is why it is a prop rather than three copies of this card.
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
  countdown = true,
}: ManagerHeaderProps) {
  return (
    // A card at the top of the page and nothing more — the scroll takes it with
    // everything else. What it used to carry, and why none of it is here:
    // `sticky top-[var(--site-header-h)] z-40` held it under the app bar,
    // `-mx-4 px-4` bled it to `PageShell`'s `wide` gutter and `bg-[…]` painted
    // the ground, both so a list could pass behind it rather than through the
    // gaps around its rounded corners, and an `::after` faded that paint into the
    // ambient aurora rather than ending it against one. All five belong to a
    // pinned surface, and the one part of this header that still is one has
    // them ({@link ListLedge}).
    //
    // `-mt-10` went with them: it cancelled the shell's own top padding so that
    // the card's resting place *was* its pinned one, and with nothing to pin to
    // the page's ordinary breathing room above the card is the right answer.
    //
    // 6px below, because what follows on every page that draws this is the filter
    // rail — a lit face, held off this one's the same way the rail holds off the
    // heading billet under it.
    <header className="mb-1.5">
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
    </header>
  );
}
