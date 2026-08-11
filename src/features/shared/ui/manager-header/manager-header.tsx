import type { ManagerHeaderProps } from "./manager-header.types.ts";
import { hasSyncCaveat } from "./manager-header.utils.ts";
import { ManagerSummary } from "./manager-summary.tsx";
import { SeasonTab, StatTab } from "./plate-corners.tsx";
import { SyncCaveats } from "./sync-state.tsx";

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
/**
 * The padding under the plate's body — and 12px of it is a *reserved lane* for
 * the sync caveats, which is the one number here worth understanding.
 *
 * {@link SyncCaveats} rides the card's bottom edge, rising 14px above it. The
 * record bar's own bottom clears that edge by 10px, so a plate landing there
 * sits on the bar. 12px more clears it with room, and reserving that space
 * **permanently** is the whole point: a lane that appeared only when a caveat
 * did would be exactly the layout shift moving the state line out of flow was
 * meant to stop.
 *
 * It is the same trade the record bar itself already makes — it keeps an empty
 * rail before a game is played, so the plate is the same height in September as
 * in December. A card above a list pays for its height in list; it should pay a
 * constant.
 */
const BODY_PADDING = "pb-5 sm:pb-6";

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
 * **It is machined, and it was the last thing on this page that wasn't.** The
 * plate was a pane of tinted glass — a translucent white gradient over a
 * hairline border — while everything under it had moved to milled parts: the
 * subject rail is a `.lab-slab`, the heading billet a `.lab-ledge`, and the
 * league cards left `LIST_ROW_SURFACE` for the trades board's corner-lit block.
 * Worse, it wore *both*: its two corner tabs are `.lab-well` and the countdown's
 * digit cells are `.lab-readout`, so the glass-to-metal join ran around the
 * card's own edge rather than between it and anything else.
 *
 * It is the **subject rail's** material rather than a league card's, and the
 * choice is not a preference. A card's `.lab-slab-face` is lit from a corner at
 * 168°, which is a claim about a card-shaped box and degenerates on one this
 * wide and this short (see the face's own comment below). The rail's fill is the
 * same material re-laid for exactly these proportions — so the plate, the rail
 * and the billet now share a wall, a chamfer family and a light direction, and
 * read down the page as one console with the list running out from under it.
 *
 * What it deliberately does *not* take is the nameplate. A league card's name
 * rides its top edge because the card is one of a hundred and needs a mark that
 * says "one object"; this plate is alone on the page and its top edge is already
 * two readouts.
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
      {/* A plain positioning box. It is what a part seated *outside* the plate's
          clip would need — the filters' key used to be one, and the wall that
          made it read as pressable is exactly what a clip would have cut off.
          Nothing is seated there now (the key leads the subject rail below). */}
      <div className="relative">
        {/* Wall wrapper and lit face, both chamfered — a wall that turns four
            corners shows a square one wherever the clip doesn't follow it. This
            is the subject rail's construction exactly, which is the point: see
            the class comment above.

            `.lab-slab-fixed` is not optional. `.lab-slab` lifts and blooms under
            the cursor because the trades board's card is a card you press; this
            is a surface holding readouts, and a header that rose under the
            pointer would promise a press that lands on nothing. */}
        <div className="lab-slab lab-slab-fixed lab-notch-all">
          {/* `-face-rail` overrides only the fill, and it is what makes this
              work at a header's proportions rather than a card's. The corner-lit
              168° gradient `.lab-slab-face` carries is a claim about a card-shaped
              box: over ~1200×130 its gradient line is ~380px, so the three stops
              resolve inside the leading third and the rest sits flat on `#0a1723`
              — three values off the page ground, with the stat tab and the dial
              at that end appearing to float. Same failure, same fix, as the rail.

              `isolate` is what the two corner tabs and the accent rail rank
              inside; `z-[1]` on the body below keeps the face's own specular
              sweep (`.lab-slab-face::after`, generated last and therefore painted
              last) under the content rather than over it. */}
          <div className="lab-slab-face lab-slab-face-rail lab-notch-all isolate w-full">
            {/* The cyan rail down the plate, echoing the league rows' accent.
                The chamfer cuts its top, which is what seats it in the part
                rather than laying it on top. */}
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 z-[2] w-1 bg-gradient-to-b from-active to-active/30 shadow-[0_0_16px_rgba(0,255,229,0.4)]"
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
              refreshing={refreshing}
              progress={progress}
              padding={BODY_PADDING}
            />
          </div>
        </div>

        {/* Outside the slab, which is the one thing about it that is not
            negotiable: `clip-path` clips a whole subtree, so a plate rendered
            inside the face would be severed at the edge it exists to straddle.
            This is what the wrapper above is for. */}
        {hasSyncCaveat({ summary, refreshError }) && (
          <SyncCaveats summary={summary} refreshError={refreshError} />
        )}
      </div>
    </header>
  );
}
