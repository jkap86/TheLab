import { memo, useMemo, useState, type MouseEvent } from "react";

import type {
  LeagueLineupSummary,
  LeagueRecord,
  LineupColumn,
  LineupSlot,
  ManagerLeague,
  ManagerLineupsPayload,
} from "@/shared/contract";
import { resolveKtcFormat } from "@/shared/ktc/board-choice";
import { isKtcMetric, lineupColumnKey } from "@/shared/ktc/columns";
import { resolveKtcLineup } from "@/shared/ktc/roster";
import {
  BubblingFlask,
  CardBilletRow,
  CardRule,
  CONSOLE_CARD_SHELL,
  CONSOLE_METAL,
  CONSOLE_WINDOW,
  ExpandedPanel,
  ktcBoardLabel,
  LeagueBillet,
  LeagueConfigWindow,
  leagueType,
  LINEUP_METRIC_LABELS,
  ordinal,
  OwnerBillet,
  useLeagueLineup,
  ordinalParts,
  positionsLabel,
  slotsLabel,
  qbBoardWord,
  Scanlines,
  StandingBay,
  StandingStrip,
} from "@/features/shared";

// Named by module path rather than through `@/features/shared`, and that is the
// whole reason the timeline sits outside that barrel: a component file is one
// module to the bundler, so a `TimelineView` reached through the barrel would
// ship the rail, the rewind and the fetch hook to every page importing anything
// shared — the trades board and the lineup checker among them, neither of which
// draws one. Named here, the chunk belongs to this route.
import { TimelineView } from "@/features/shared/ui/timeline";

import {
  rankColor,
  rankFill,
  rankPercentile,
  winSharePercentile,
} from "../helpers/lineup-metrics";


/**
 * One league, as an instrument housing that rises toward the viewer.
 *
 * **The card is a bezel with lit windows set into it**, not a pane of glass
 * with tiles floating on it — the same object a trade card is, which is the
 * whole point of the console-card language: a reader arriving from `/trades` or
 * `/lineupchecker` is looking at the same leagues, and the three cards should
 * read as one instrument seen from three tools.
 *
 * **It is the lineup checker's card with a different pair of readings in it**,
 * which is a convergence rather than a redesign: `/manager` and
 * `/lineupchecker` list the same leagues, and until this pass they drew them
 * as two different objects — this card on a milled billet ledge over a tray of
 * chips, that one on two plates over a lit config window. A reader walking
 * between the two tools sees one after the other, so the drift was visible in
 * the one place a single-page render could never show it. Everything
 * structural here is now `lineup-check-card.tsx`'s, to the value: the metal
 * finish, the four decorative layers, the paddings, the tilt, the plate row
 * and the window. What differs is what the plate says and what the tiles hold.
 *
 * **The header is two plates from `sm` up, and one plate over a milled strip
 * below it.** Two plates compete for one line: the reading plate keeps its
 * width and the league's name, which is the card's whole subject, truncates
 * into what is left. That measurement is why the billet ledge existed, and it
 * did not go away when the ledge did — at 362px the name was ~95px, cut to
 * "Dynasty Wa…", *after* `Pts` had already been dropped from the plate
 * opposite to buy that much. So on a phone the plate row carries the league
 * alone at full width and the standing comes down onto its own part under the
 * rule: all three fields are back, `standingFields`' phone rule is gone with
 * the plate it was buying width from, and the name stops truncating. See
 * {@link StandingStrip}.
 *
 * **The settings are a milled strip**, where they were four paired chips in a
 * recessed tray and, before this pass, a lit window.
 * `LeagueChipRail` and `LeagueConfigWindow` are two arrangements of one read —
 * both go through `readLeagueConfig`, so neither can drift from the other or
 * from the Filters dialog that narrows by the same rules — and this card takes
 * the strip because that is what the other two cards draw. The rail stays where
 * it is, with its tokens: nothing is deleted by a card choosing the other
 * arrangement.
 *
 * **The strip and the standing are the card's two bolted-on parts, in that
 * order.** Settings first, directly under the rule and the plate that names the
 * league, because what game this is is a property of the league; the standing
 * second, against the four rank windows it belongs with, because it is a
 * result. They are cut from one piece of stock — see {@link StandingStrip} —
 * so the pair reads as one block with a groove between rather than as two
 * unrelated readouts, which is what lets the gap between them close to 8px.
 * Above `sm` there is nothing here to order: the standing is on the plate row.
 *
 * **The card wears the metal finish** ({@link CONSOLE_METAL}), which is a set
 * of token overrides on the `<details>` rather than a single element of
 * markup: the housing, both plates and every key inside already name the three
 * tokens it moves, so the cascade applies it. The grain is a background layer
 * for the same reason the decorative span below exists — an overlaid brush
 * would have to be clipped, and a clip is what collapses the depth.
 *
 * The rise is real perspective, not a `translateY`: the `<li>` owns the
 * `perspective`, the card sits at `rotateX(3deg)` at rest and flattens to
 * `translateZ(30px)` on hover, and the contents carry their own small
 * `translateZ` so the type separates from the housing as it comes forward. An
 * **open** card is held flat, because a tilted card with a twelve-team table
 * inside it is unreadable — opening it is the end of the same motion hovering
 * starts.
 *
 * Two things that look optional are not, and both were found the hard way on
 * the tools page:
 *
 * 1. `transform-style: preserve-3d` cannot coexist with `overflow: hidden`,
 *    which forces a flat rendering context and silently collapses every child
 *    `translateZ`. So the decorative layers live inside one absolutely
 *    positioned wrapper that does the clipping, and the content stays a direct
 *    child of the card. Do not move the clip onto the card. The same rule is
 *    why each tile's scanlines stay inside that tile, which they already do.
 * 2. The card must be `flex-1` inside a `flex` `<li>`, never `h-full`. A
 *    percentage height cannot resolve against an auto-sized grid row.
 *
 * **An open card is the screen, and nothing here is sticky any more.** A
 * twelve-team table is taller than the viewport, so a reader three scrolls into
 * one had nothing on screen saying which league they were reading — the name is
 * on a plate at the card's top edge and the top edge was gone. That was patched
 * by freezing this `<summary>` under the rack while the rest of the list stayed
 * in flow behind it, which fixed the name and left the reader scrolling a
 * hundred-league document to read one league.
 *
 * The list stands down around an open card instead — see `useActiveCard`, which
 * owns the park, the lock and the `?league` param. There is nothing to stick
 * within once the list is one card tall, so the three sticky variants and the
 * token they read are gone from here.
 *
 * **The disclosure is driven rather than native**, and that is the one thing
 * this card gave up to it: `open` says whether the panel is in the flow and
 * `onToggle` is the press, because the *page* has to change with the toggle and
 * a `<details>` that toggled itself would be open for a frame before anything
 * else knew. The `<li>`'s existing `has-[details[open]]:z-10` still orders the
 * open card above its neighbours, and the parked shell reads the same
 * `[open]` to decide which card survives — see `globals.css`.
 *
 * **`lit` is a second question from `open`, and the collapse is why.** The
 * disclosure stays open for as long as the panel takes to close, so chrome hung
 * off `[open]` would hold its border, halo and edge light through the whole
 * collapse and let go afterwards. `data-lit` is what every one of those
 * variants reads instead, so the card lets go *as* the panel closes — its own
 * 450ms transitions running out under the 300ms collapse.
 *
 * **`memo`'d, and that is what the driven disclosure costs.** Opening a card
 * used to be a native `<details>` toggle: zero renders, whatever the list's
 * length. It is a state change on the page now, so without this a press
 * re-renders every league on the account to move two of them — measured at
 * 264ms for a page of six fixture cards in a dev build, and this page is one
 * card per league on a 113-league account. Every prop is stable by
 * construction: `league` and `entry` are references out of the payload,
 * `columns` is memoised on the stored string, the three narrowing props are
 * the page's own values, `onToggle` is a `useCallback` that takes the id, and
 * `open`/`lit` are the two booleans that are *meant* to change — for the card
 * that opened and the one that closed, and no others. Which cards stand down
 * is CSS reading the open disclosure rather than a prop, for the same reason.
 *
 * The card stays hook-free, as before: the one interaction it owns is the
 * disclosure, and the state a card does need lives below it — which team and
 * which metric in `LeagueTeams`, and where in the league's history the reader
 * is standing in `TimelineView`, which draws that browser over the rosters of
 * whichever moment the rail is on.
 *
 * All of the depth — the perspective, `preserve-3d`, every `translateZ`, the
 * open-state lift/halo shadows — rides `pointer-fine:`, because its budget is
 * per-device rather than per-card: the stack is several composited planes *per
 * league*, with no virtualization, and iOS Safari's per-tab GPU budget dies on
 * it the moment a card opens ("a problem repeatedly occurred") where a desktop
 * never notices. The tilt is a pointer affordance anyway — it exists to be
 * flattened by a hover — so a coarse pointer gets the same card flat, with the
 * border accent, glow and edge light as its open affordance.
 * `lineup-check-card.tsx` carries the identical gate.
 */

/** `8–5`, or `8–5–1` where the league has ties and this manager has one. */
function formatRecord(record: LeagueRecord): string {
  const base = `${record.wins}–${record.losses}`;
  return record.ties > 0 ? `${base}–${record.ties}` : base;
}

/**
 * The window row, per column count, spelled out so Tailwind sees each class it
 * must generate.
 *
 * The windows have the card's full width to themselves, so they take equal
 * shares of it and the row reads as one instrument strip across the card.
 *
 * **Four across at every width, phones included**, which reverses the two-up
 * fallback this row used to take below `sm`. What made a four-way split at 390
 * unreadable was the figure: the rank printed "2nd of 12", which needs ~86px at
 * 16px mono and cannot fit an equal quarter of a phone-width card. The
 * denominator has since come out of the window — it is one number for all four
 * ranks and is stated in the chip rail's `Teams` — so the figure is an ordinal
 * with its suffix demoted, and the strip is one row rather than two. A four-way
 * strip that wraps is what pushes the card past the fold on a phone.
 */
const GRID_COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-4",
};

export const LeagueCard = memo(function LeagueCard({
  league,
  columns,
  teamsColumn,
  slots,
  summary,
  ranksPending = false,
  ownerName = null,
  ownerAvatarUrl = null,
  season,
  username,
  open,
  lit,
  onToggle,
}: {
  league: ManagerLeague;
  /** The chosen rank columns, in canonical order — see `useLineupColumns`. */
  columns: readonly LineupColumn[];
  /**
   * What the expanded card's standings pane reads — see `useTeamsColumn`.
   *
   * **It is also what a past stop is priced on**, which is why it reaches the
   * rail rather than stopping at the pane: the two boards a stop is solved
   * against have to be the two the table in front of it is on, and that table
   * names its own now. It replaces the `board` prop this card used to take,
   * which was always `"auto"` and was there to say exactly that — that the rail
   * follows the table.
   */
  teamsColumn: LineupColumn;
  /** The starting seats this account's leagues run — that picker's slot track. */
  slots: readonly LineupSlot[];
  /**
   * This league's ranks, once the batched lineups read lands.
   *
   * **Ranks and nothing else**, which is what the batched read now carries: the
   * teams this card's expanded half browses are fetched for the one league a
   * reader opens — see {@link LeagueDetail} below and `LeagueLineupSummary`.
   */
  summary?: LeagueLineupSummary | null;
  /**
   * The batched read has not answered yet — so a window with no rank is one
   * that is *waiting* rather than one with nothing to say.
   *
   * The page's own state and not this card's, because `summary` cannot tell the
   * two apart: it is null while the read is in flight and null forever for a
   * league the read does not answer for at all (a chopped one, which this list
   * carries and the lineups query does not). See `ManagerLineupsState.pending`.
   */
  ranksPending?: boolean;
  /**
   * Who holds the picked player in **this** league, where a leaguemate does —
   * already abbreviated, and null where there is nobody to name.
   *
   * **Resolved by the page rather than read here**, and as two primitives
   * rather than one object, which is this card's `memo` rather than a style: a
   * `{ name, avatar }` built fresh in the page's own render would be a new
   * reference on every render and would re-render all 113 cards to move the one
   * that changed. Every other prop is stable by construction for the same
   * reason — see the note above.
   *
   * Null covers every case the readout is not for, and they are not
   * distinguished on purpose: no subject picked, two picked, a subject not on
   * the taken narrowing, the rosters map still in flight, or a league where
   * nobody but the manager holds him. The part exists for the taken narrowing
   * and a league outside it simply draws none — see {@link OwnerBillet}.
   */
  ownerName?: string | null;
  ownerAvatarUrl?: string | null;
  /**
   * What a *past* stop is priced against — the same season and manager the
   * present table was solved on, so the two are one comparison rather than two
   * rulers. See `TimelineSubject`.
   */
  season: string | null;
  username: string;
  /** Whether the disclosure is open — the page's, not the element's own. */
  open: boolean;
  /** Whether the chrome is lit: open, and not yet collapsing. See the note. */
  lit: boolean;
  /** The press. `useActiveCard` drives the disclosure and the list together. */
  onToggle: (id: string, event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    // The `perspective` makes each `<li>` its own stacking context, so a card
    // that rises cannot paint over the one after it in DOM order — the raise
    // has to be ordered here, on the grid item, rather than on the summary
    // inside it. Without this an open card sits *under* the card to its right,
    // which is the one moment the raise is most visible.
    // `data-card` is how the close finds this row again once the list has come
    // back around it — see `useActiveCard`, which reads its line to put the
    // reader back where they pressed rather than at the document's top.
    <li
      data-card={league.league_id}
      className="relative flex pointer-fine:[perspective:2400px] hover:z-10 has-[details[open]]:z-10"
    >
      {/* `min-w-0` is what lets the card shrink to a phone. The `<li>` is a
          row flex container, so its item takes `min-width: auto` and refuses
          to go below its own min-content — and the expanded half's two panes
          sit side by side at every width by design, which puts that
          min-content above 390. Without this the card is wider than the
          viewport and the whole page scrolls sideways. */}
      <details
        open={open}
        data-lit={lit ? "" : undefined}
        // **The housing is the `<details>`, not the `<summary>`**, since the
        // expanded-card pass — see the note above the summary. Everything that
        // is the card's *object* lives here: the shell, the metal, the tilt,
        // the lit and hover chrome, and the reduced-motion hook.
        //
        // **An open card is flat at `translateZ(0)`, and hovering it lifts
        // nothing.** It was held at `translateZ(20px)` while lit and lifted to
        // 30 under a hover, and both were the summary's alone; with the whole
        // housing transformed, a lift is a projection of the *card* — 0.84%
        // larger under the list's 2400px perspective — and the open card is
        // the parked shell's exact height, so 20px of lift was a housing 3px
        // taller than its shell and a scrollbar on a list with nothing to
        // scroll. The halo and the lit border are what say the card is open;
        // there is no neighbour left on the page for it to rise above. The
        // hover lift is gated to a closed card (`:not([open])`) for the same
        // reason, and to the summary rather than the whole housing so that a
        // pointer crossing a closed card's edge is what lifts it — the only
        // part of a closed card there is.
        className={
          `group/card lab-card-3d ${CONSOLE_CARD_SHELL} ${CONSOLE_METAL} flex min-w-0 flex-1 flex-col ` +
          "pointer-fine:[transform-style:preserve-3d] [transform-origin:center_bottom] " +
          "pointer-fine:[transform:translateZ(0)_rotateX(3deg)] " +
          "pointer-fine:[&:not([open]):has(summary:hover)]:[transform:translateZ(30px)_rotateX(0deg)] " +
          "pointer-fine:data-[lit]:[transform:translateZ(0)_rotateX(0deg)] " +
          "transition-[transform,box-shadow,border-color] duration-[450ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] " +
          "has-[summary:hover]:border-active/45 data-[lit]:border-active/45 " +
          "pointer-fine:[&:not([open]):has(summary:hover)]:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)] " +
          "pointer-fine:data-[lit]:shadow-[var(--housing-shadow),var(--card-lift-hover),var(--card-halo-hover)]"
        }
      >
        {/* Everything decorative, in the one layer that clips — and the one
            place in the card that is *before* the summary in the tree. It is
            the housing's layer now rather than the summary's, so the glow, the
            floor and the edge light cover the whole card, open half included,
            rather than ending at the seam. First rather than last so it paints
            under everything: a positioned `z-auto` span is painted in tree
            order among its siblings' positioned content, and the summary and
            the panel both come after it. (A `z-index` would have done the same
            and needed a stacking context on the housing to be contained by;
            `isolation: isolate` is a grouping value that flattens `preserve-3d`,
            and the transform that would otherwise provide one is
            `pointer-fine:` only.) The browser reads the *first summary child*
            as the disclosure whatever precedes it.

            The sheen and the floor only ever move under a hover, so they stay
            out of the tree entirely on a coarse pointer rather than sitting
            there as gradients nobody sees. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
        >
          <span className="lab-anim absolute inset-y-0 left-0 hidden w-[55%] -translate-x-[180%] -skew-x-12 bg-[image:var(--card-sheen)] transition-transform duration-[900ms] ease-out group-hover/card:translate-x-[450%] pointer-fine:block" />
          <span className="absolute -inset-x-1/4 -bottom-[8%] hidden h-[62%] origin-bottom bg-[image:var(--card-floor)] opacity-40 transition-opacity duration-[450ms] [mask-image:linear-gradient(to_top,#000,transparent_72%)] [transform:perspective(320px)_rotateX(66deg)] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100 pointer-fine:block" />
          <span className="absolute -bottom-[45%] left-1/2 h-[85%] w-[120%] -translate-x-1/2 bg-[radial-gradient(closest-side,var(--accent-glow),transparent_75%)] opacity-30 transition-opacity duration-[450ms] group-hover/card:opacity-80 group-data-[lit]/card:opacity-80" />
          <span className="absolute inset-x-[18%] top-0 h-px bg-[image:var(--card-edge-light)] opacity-0 transition-opacity duration-[450ms] group-hover/card:opacity-100 group-data-[lit]/card:opacity-100" />
        </span>
        <summary
          onClick={(event) => onToggle(league.league_id, event)}
          // **The summary is the card's header and nothing else.** It used to
          // carry the housing — the shell, the tilt, the hover lift — and the
          // expanded half was a sibling *under* it: a second housing below the
          // first, which is the "card inside a card" the expanded-card pass
          // closed. With the shell on the `<details>` the summary is the top
          // half of one part and the panel the bottom half, and the groove
          // between them is a cut in one piece of stock. What stays here is
          // what a header owns: the inset, the `preserve-3d` its own planes
          // project through (a `preserve-3d` parent is what carries the
          // housing's context down to the windows' `translateZ`), and the
          // focus ring, since the summary is the element a keyboard lands on.
          className={
            // **`flex-1` while shut and `flex-none` while open**, and the
            // second half is what keeps the panel's own measurement honest
            // rather than being a layout preference. The `<details>` is a
            // column flex container, so a header that grows absorbs whatever
            // slack the panel does not take — and the panel is sized from
            // `panel.offsetTop`, which *is* the header's height. Left growing,
            // the two feed each other: the room reads back as whatever the
            // panel happens to be, every value of which is self-consistent,
            // and around `MIN_PARKED` two of them alternate forever. Driven,
            // a card opened before its lineups landed strobed at 60fps between
            // a 107px panel under a 694px header and a 320px panel under a
            // 481px one, and the empty state's line jumped 200px with it. At
            // its natural height the header is a constant the panel is
            // measured against, which is what {@link usePanelCap} has always
            // assumed and what the trades board's own summary spells as
            // `shrink-0`.
            "relative flex flex-1 cursor-pointer list-none flex-col font-mono group-open/card:flex-none " +
            // **The gutter is 14px below `sm`**, where the card takes 18px from
            // `sm` up. Four windows across a 362px card is what asks for it —
            // the strip is the card's full width less this inset, and the four
            // labels are the tightest thing on the page. It composes the
            // *shell* rather than appending to `CONSOLE_CARD`, because two base
            // `px-*` utilities of the same specificity are decided by
            // Tailwind's emit order — see that constant's note.
            //
            // **One top padding, where the ledge needed two.** A ledge was a
            // whole part hung off the card's edge and was two heights — the
            // name line alone where a league had no standing to cut a well
            // for, both lines where it had — so the card had to ask
            // `standingFields` which one it was clearing. A plate hangs 13px
            // above the edge whether or not there is a plate opposite it, so
            // one number clears it in every case and there is nothing left to
            // branch on.
            //
            // **The whole inset is smaller below `sm`** — `30 / 14 / 14`
            // against the desktop `34 / 18 / 18` — which is the same argument
            // as the gutter one line down, spent on the other two axes. The
            // card carries four parts on a phone (the settings strip, the
            // standing, the four rank windows and, open, the browser under
            // them) and every one of them wants the width. The top padding is
            // what clears the billet hung 16px / 18px above the edge with the
            // same 13–16px to spare a plate used to get, which is what it is
            // *for* rather than a rhythm it happens to sit on; it rose 4px at
            // both widths when the plate became a billet.
            //
            // **The bottom padding is 0 while the card is open.** The expanded
            // half is no longer a housing set 14px into the card — it is the
            // same piece of stock under a milled groove, and the groove is
            // the panel's first child (see `ExpandedPanel`). So the summary
            // hands its bottom inset to the panel for as long as there is a
            // panel; shut, a card is one housing and keeps it, or the rank
            // windows would sit flush on its bottom edge. `group-open` rather
            // than `group-data-[lit]` because the padding has to hold through
            // the collapse: `lit` goes off as the close *begins*, and 18px
            // returning under a panel still clipping shut is a jump.
            "px-3.5 pb-3.5 pt-[1.875rem] sm:px-[1.125rem] sm:pb-[1.125rem] sm:pt-[2.125rem] group-open/card:pb-0 " +
            "pointer-fine:[transform-style:preserve-3d] " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60"
          }
        >

          {/* Outside the clipping layer: the billet straddles the top edge, and
              a clip is exactly what would cut it off. It is a billet rather
              than a plate since the expanded-card pass — the name engraved in
              chrome on the same stock as the two strips under it. See
              `LeagueBillet` for what that replaced and why. */}
          <CardBilletRow>
            <LeagueBillet name={league.name} avatarUrl={league.avatar_url} />
            {/* Who has the picked player here, in the row's own overhang — so
                the answer costs the card no height and reads down a column of
                cards. Drawn only where a leaguemate holds him, which is the
                narrowing the reader is already looking at; see `OwnerBillet`
                for why there is no `You` or `Free` arm beside it. */}
            {ownerName != null && (
              <OwnerBillet name={ownerName} avatarUrl={ownerAvatarUrl} />
            )}
          </CardBilletRow>

          <CardRule />

          {/* What game this league is playing, where the identity line used to
              be. It is the lineup checker's own strip and the same component,
              so a league described one way there cannot be described another
              here — and the team count is stated once, as the strip's own
              `Teams`, which is the only place the card still names the field
              size the ranks below are out of. `18px` sits between the windows'
              22px and the plates, so the planes read front to back.

              **It comes before the standing, which reverses the order this card
              carried until now.** The two are the card's only bolted-on parts
              and they answer two different questions: what game this league is,
              and how the manager is doing at it. The first is a property of the
              league, so it belongs first; the second is a result, and it
              belongs nearest the four ranks that grade it.

              **They share a row from `sm` up and stack below it**, which is one
              arrangement rather than the two this card used to switch between —
              a plate opposite the league's name on a desktop and a strip under
              the rule on a phone. What made that a problem is what the plate
              always cost: the name is the card's subject and a plate beside it
              is width the name is paying for, mildly at 1280 and severely at
              390. So the plate row is the league's alone at every width now,
              and the standing is a part on the housing wherever it fits.

              The strip takes the slack (`flex-1 min-w-0`) and the bays hug their
              content, because three bays stretched across a desktop card read
              as an instrument with nothing in it — the design file's `1b`
              against its `1c`. Sharing costs the strip ~230px of the box every
              one of its measured word-dropping thresholds was measured
              against, which is why it is told it is `shared` rather than left
              to clip: see that prop. */}
          <div className="relative mt-3 flex flex-col items-stretch gap-2 sm:mt-3.5 sm:flex-row sm:gap-2 pointer-fine:[transform:translateZ(18px)]">
            <LeagueConfigWindow league={league} shared className="min-w-0 flex-1" />
            {/* One copy at one position, at every width — the two arrangements
                are a `flex-direction` and a `fill`, not two elements with a
                `display: none` between them. Three figures rendered twice is
                three figures read twice to anything listening, which is what
                the plate-and-strip pair had to be careful about and this has
                nothing to be careful about at all. */}
            <StandingStripFields league={league} />
          </div>

          {/* The ranks get the row to themselves, under the rail rather than
              beside it — so the windows stay a direct child of the summary,
              which is what keeps their `translateZ` alive. A wrapper here would
              be a flat rendering context and the depth would silently go. */}
          <div
            className={`relative mt-2 grid gap-1.5 sm:mt-2.5 sm:gap-2 ${GRID_COLS[columns.length] ?? GRID_COLS[2]} pointer-fine:[transform:translateZ(22px)]`}
          >
            {columns.map((column, i) => (
              <RankWindow
                key={lineupColumnKey(column)}
                column={column}
                league={league}
                summary={summary}
                pending={ranksPending}
                // Four windows mount in one frame, so four flasks would bubble
                // in lockstep and read as one four-part widget rather than as
                // four instruments each doing their own work. The index is
                // already in hand — see `BubblingFlask`'s `phase`.
                phase={i}
              />
            ))}
          </div>

          {/*
            **The field size is stated once on this card, in the configuration
            window's `Teams`, and there used to be a second copy here.**
            `RankedOf` printed `Ranked of 12` under the strip — the same number
            as `Teams`, 40px above it, and the only right-aligned caption on a
            card where everything else is left. It is gone rather than moved:
            the window's field is the scale every count beside it is already
            read against, so the choice was between two spellings of one
            denominator and one, and the surviving one is the one with a
            vocabulary around it.

            The reading it *could* make and `Teams` cannot is a rank's own `of`
            — the rosters a metric could total, which is not always every seat —
            but that gap is a guard rather than a case (every metric ranks the
            same stored rosters), and a caption that is right about a case
            nobody has is not worth a second denominator on every card.
          */}
        </summary>

        {/* **The expanded half is an inner housing, not a lit window.** It was
            `CONSOLE_WINDOW` — a pane of glass holding more panes of glass, which
            is what made the history rail, the two panes and the pick plates read
            as one flat sheet of readings rather than as parts of an instrument.
            It is the bezel those parts are *mounted on* now, which is the
            grammar the lineup checker's week view already wears one tool over
            (`CONSOLE_HOUSING_INSET`), and the 14px radius is the inner one — a
            nested surface repeating the card's own 18px reads as a card that has
            slipped out of its frame.

            It stays *outside* the summary's `preserve-3d` subtree, as it always
            has, and owns a shallow perspective of its own instead. That is not
            the same claim: `preserve-3d` cannot survive a clip and `perspective`
            can, so the housing can both hold its parts on their own planes and
            keep the `overflow: hidden` its radius needs. The three depths are
            small and ordered by what a reader reaches for — the panes forward,
            the rail behind them — so the card reads as layers rather than boxes.

            All of it rides `pointer-fine:`, on the summary's own argument and
            for the same budget: a plane here is a composited layer *per league*
            on a page with no virtualization, and there is no hover to flatten
            it on a touch device. A coarse pointer gets the identical housing
            flat.

            **It is a component rather than a `<div>` because it measures
            itself**: an open card parks under the rack and the panel caps to
            what is left of the viewport, which is two numbers no stylesheet
            can hold. That is `ExpandedPanel`, and it is a component of its own
            so this card stays hook-free. */}
        <ExpandedPanel open={open} closing={open && !lit}>
          {/* **No wrapper between the housing and its parts**, and this is
              the half of the perspective that is silent when it is missing: a
              `perspective` projects an element's *direct children only*, and an
              intermediate `<div>` is `transform-style: flat` — so the rail, the
              panes and the picks would compute their `translateZ` against no
              projection at all, and the housing would be three flat boxes with
              a depth nobody can see and no error to say so. There was one here
              (the old lit window needed a `relative` layer to hold its content
              above the scanlines); the housing has no scanlines, so it is gone.
              `LeagueTeams` carries the `preserve-3d` that reaches its own two
              parts, for the same reason one level down. */}
          <LeagueDetail
            leagueId={league.league_id}
            season={season}
            username={username}
            teamsColumn={teamsColumn}
            slots={slots}
            open={open}
          />
        </ExpandedPanel>
      </details>
    </li>
  );
});

/**
 * The expanded half's own read: this league's twelve rosters, solved.
 *
 * **It is a component so the card above stays hook-free** — that card's own
 * stated design, and `LeagueSyncKey`'s precedent — and it is the manager page's
 * half of the split the batched lineups route made. That route answers ranks
 * for a hundred leagues; the teams a browser renders are one league's, wanted
 * one league at a time, and this is where they are asked for. It is the trades
 * board's `TradeLeague` doing the same job over the same hook, and deliberately
 * so: two cards drawing one league through two reads is how the two would come
 * to disagree.
 *
 * **`opened` is a one-way latch and `open` is the press.** A `<details>` hides
 * its body rather than unmounting it, so this is mounted for every league on
 * the account — a hundred of them must cost nothing until a reader opens one.
 * Once opened, closing must not throw the answer away and re-opening must not
 * pay for it again; the store behind `useLeagueLineup` keeps it, bounded, so
 * even a latch released by a re-render costs nothing.
 *
 * **The `ktc` stamp comes from this read rather than from the page's.** The
 * batched payload still carries the markets it priced its ranks on, but the
 * standings pane's picker is a picker for *this* answer, and its foot should
 * say when the board this table was priced on was scraped.
 *
 * **The three states under the housing are three different sentences**, the
 * trade card's own rule: a read in flight says so, a failed one says so, and a
 * league with no stored rosters gets `TimelineView`'s empty child. Collapsing
 * them would make an ordinary answer look like a fault.
 */
function LeagueDetail({
  leagueId,
  season,
  username,
  teamsColumn,
  slots,
  open,
}: {
  leagueId: string;
  season: string | null;
  username: string;
  teamsColumn: LineupColumn;
  slots: readonly LineupSlot[];
  open: boolean;
}) {
  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);

  // `useMemo` so the identity is stable across the renders this card takes for
  // reasons that have nothing to do with its league: the subject is what both
  // reads below are keyed by, and a fresh object each render is a fresh key.
  const subject = useMemo(
    () => ({
      leagueId,
      season,
      username,
      // **The teams column, where this used to be `board="auto"`.** That
      // literal was the right answer to the question as it stood: the rail
      // redraws this card's own team browser, that browser read
      // `LeagueTeam.totals`, and the route computed those on the league's own
      // market and QB board whatever any bay had forced — so `auto` was what
      // kept a past stop and the present table on one ruler. The browser names
      // its own board now, and the same argument points the other way: the rail
      // follows *it*.
      column: teamsColumn,
    }),
    [leagueId, season, username, teamsColumn],
  );

  const { payload, loading, error } = useLeagueLineup(subject, opened);
  const entry = payload?.entry ?? null;

  return (
    <TimelineView
      subject={subject}
      entry={entry}
      column={teamsColumn}
      ktc={payload?.ktc ?? NO_KTC}
      slots={slots}
      // The reader's own team, so a past stop marks and ranks the same team the
      // present table does. Read off the answer the table is drawn from, so the
      // two cannot disagree; null while the read is in flight, which marks no
      // team rather than the wrong one.
      managerRosterId={entry?.teams.find((t) => t.is_manager)?.roster_id ?? null}
    >
      {loading ? (
        <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
          Reading the league…
        </p>
      ) : error !== null ? (
        <p className="m-0 text-[length:var(--fs-12)] text-error">{error}</p>
      ) : (
        <p className="m-0 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-readout-label">
          No rosters read for this league yet
        </p>
      )}
    </TimelineView>
  );
}

/**
 * No market answered — a read in flight, or one whose board could not be. A
 * shared empty so the pane below is not handed a new array identity per render.
 */
const NO_KTC: ManagerLineupsPayload["ktc"] = [];

/** No answer for a field, in the app's own grammar: never a zero. */
const NO_FIGURE = "—";

/**
 * Record, standings rank and points rank — the card's standing, in the two
 * places one card puts it.
 *
 * **Three fields or none at all, and the two absences are different
 * absences.** A league whose rosters have not been read has nothing to state —
 * no record, no rank — and neither the plate nor the strip is drawn, where
 * drawing an empty one would read as a rendering fault. A league that *is*
 * read but has not played yet has a real answer for one field and no answer
 * for the other two, and it draws all three with `—` where the ranks would go.
 *
 * **A rank that vanishes and a rank that is unknown look identical, which is
 * why the fields stopped being conditional.** Before a season starts every
 * league on the page carried `Rec 0–0` alone, and a reader had no way to tell
 * that from a league whose ranks the card had simply not been given: the plate
 * was a different shape per league for a reason nothing on it explained. The
 * dash is the same three-way grammar the rank windows below already read by —
 * a figure, or a dash, and never a `1st` nobody has earned.
 *
 * **And all three survive at every width**, which is the phone header's own
 * point and is unchanged by any of it. The rule that dropped `Pts` below `sm`
 * existed to buy the league name width back from the plate opposite it, and
 * below `sm` there is no plate opposite it any more — the standing is a strip
 * of its own under the rule, and the name has the row.
 *
 * **Each field carries its own percentile, or null**, because the two readings
 * colour by different rules and only this function knows which is which: a
 * rank is its place in the field on the ramp the windows below already run,
 * and a record is its win share stretched across the band records land in. A
 * dash carries null and lands on the neutral, which is `rankPercentile`'s own
 * rule one grain over — painting an absent answer red claims a last place
 * nobody finished in. The colour is spent only on the strip: the plate stays
 * one ink, since three ramp colours on a pill the width of a thumb is a bar
 * chart rather than a reading.
 *
 * The card's rank *windows* are untouched by any of it: this is the standing's
 * three figures, not the four the strip below ranks.
 */
function standingFields(
  league: ManagerLeague,
): { label: string; value: string; percentile: number | null }[] {
  // Nothing read for this league at all. `toRecord` answers null only where no
  // roster of theirs is stored, which is the same join the ranks come off — so
  // in practice the record is the gate and the two ranks are belt and braces.
  if (
    league.record === null &&
    league.standings_rank === null &&
    league.points_rank === null
  ) {
    return [];
  }
  // The field size every rank here is out of. `rankFill` answers 0 for a
  // one-roster league, which is the same "no spread to show" the meters take.
  const of = league.total_rosters;
  // **Rank leads, and the record follows it.** The standing is what the plate
  // is read for — the record is how it was arrived at — so it takes the
  // position a reader's eye lands on first, nearest the card's own edge.
  return [
    rankField("Rank", league.standings_rank, of),
    {
      label: "Rec",
      value: league.record ? formatRecord(league.record) : NO_FIGURE,
      percentile: league.record
        ? winSharePercentile(league.record.wins, league.record.losses)
        : null,
    },
    rankField("Pts", league.points_rank, of),
  ];
}

/** One of the two ranks, as a figure and a percentile or as a dash and null. */
function rankField(
  label: string,
  rank: number | null,
  of: number,
): { label: string; value: string; percentile: number | null } {
  if (rank === null) return { label, value: NO_FIGURE, percentile: null };
  return { label, value: ordinal(rank), percentile: rankFill({ rank, of }) };
}

/**
 * The standing as a part bolted to the housing, at every width.
 *
 * **Three bays or none**, and it read as an arrangement that tolerated one or
 * two until the ranks stopped being conditional; a strip two thirds empty is
 * what it was tolerating, and a machined part with a bay missing out of it
 * reads as a fault. The strip is still drawn only where there is something to
 * put in it — see {@link standingFields} for the one case that answers nothing
 * at all.
 *
 * **The bays stretch only on the row they own**, which is the strip's own rule
 * rather than something asked for here — see {@link StandingStrip}. It turns on
 * the same `sm` the row's `flex-direction` does, because it is the same
 * question: is there another part on this line.
 *
 * The figures take the ramp: see `standingFields` for which rule each field's
 * percentile comes from, and {@link StandingBay} for why the colour lands here
 * rather than on a plate.
 */
function StandingStripFields({ league }: { league: ManagerLeague }) {
  const fields = standingFields(league);
  if (fields.length === 0) return null;

  return (
    <StandingStrip>
      {fields.map((field) => (
        <StandingBay
          key={field.label}
          label={field.label}
          tone={rankColor(field.percentile)}
          glow={rankColor(field.percentile, 0.35)}
        >
          {field.value}
        </StandingBay>
      ))}
    </StandingStrip>
  );
}

/**
 * One rank column, as a lit window: two words, the ordinal and a meter.
 *
 * **Both words are on the glass with the figure**, which is the lineup
 * checker's tile and is where they were before the billet pass put them on a
 * machined header above it. The argument for the header was that a caption and
 * a number on one surface are peers however they are sized; the argument
 * against is that four tiles on this card and four on the checker's are the
 * same strip read one tool apart, and a hierarchy stated in *type* carries on
 * one surface — `--fs-11` on `--readout-line` over `--fs-10` on
 * `--readout-label`, which is exactly what `MetricTile` does one page over.
 *
 * **The meter stays, and it is the one thing here that does not converge.**
 * The checker's tiles have none, and they are right not to: a check is a count
 * or a clearance and has no field to sit in. A rank is a *position in a field*,
 * and the bar is what states the field — the denominator came out of the
 * figure precisely because the meter was already saying it. It is a 2px
 * hairline with no glow on its fill, which is what lets it sit under a hundred
 * cards' worth of figures without becoming the loudest thing on the page.
 *
 * **The suffix is demoted so the digit reads first**: a size down, a weight
 * lighter and at 55% opacity, which is what makes a page of cards scannable by
 * their numerals. The 11th–13th rule stays in `ordinalParts` rather than being
 * spelled again here — see that function.
 *
 * **The colour is the rank**, on the red -> neutral -> green ramp, driven by
 * the same percentile as the meter's width so the bar and the hue cannot
 * disagree. It used to be the metric's *family* — accent for points,
 * `--metric-secondary` for capital — which told a reader the unit; the words
 * above the figure are what carry that now.
 *
 * `mt-auto` on the figure block is what holds four figures on one baseline
 * when one window's scope line is empty, which is every KeepTradeCut column —
 * see `tileScope`. Both label lines keep their reserved height for the same
 * reason, on a phone where the figure has nothing under it to level against.
 */
function RankWindow({
  column,
  league,
  summary,
  pending = false,
  phase = 0,
}: {
  column: LineupColumn;
  league: ManagerLeague;
  summary?: LeagueLineupSummary | null;
  /** The page's read has not answered — see {@link LeagueCard}'s own prop. */
  pending?: boolean;
  /** Which of the row's windows this is, so the four do not bubble together. */
  phase?: number;
}) {
  const rank = summary?.ranks[lineupColumnKey(column)] ?? null;
  const fill = rankFill(rank);
  // Not `fill`: that is 0 for last place *and* for nothing-to-rank, and only
  // the first of those is red. See `rankPercentile`.
  const percentile = rankPercentile(rank);
  const tone = rankColor(percentile);
  const words = LINEUP_METRIC_LABELS[column.metric];
  const parts = rank ? ordinalParts(rank.rank) : null;
  const scope = tileScope(column, league);

  return (
    <div
      className={`${CONSOLE_WINDOW} flex min-w-0 flex-col rounded-[0.625rem] p-1.5 sm:px-2 sm:py-2.5`}
    >
      <Scanlines />
      <div className="relative">
        {/* **Untracked below `sm`, and that is a fit rather than a taste.** An
            equal quarter of a phone-width card is ~79px of window and ~65px of
            label box, against `Draft cap` at 64.9px tracked. The checker's own
            strip made the identical measurement. */}
        <p className="m-0 min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-10)] uppercase leading-[1.2] text-readout-line sm:text-[length:var(--fs-11)] sm:tracking-[0.1em]">
          {words.unit}
        </p>
        {/* Empty on an un-narrowed KeepTradeCut column, which is why the height
            is reserved rather than left to the content: a strip of four with one
            scope missing would otherwise read as four windows at four
            heights.

            **Two spellings switched by the cascade**, for the reason the bay in
            the columns picker has two: at 390 the label box is 65px against
            `--fs-9`'s ~6.2px an em, which is ten and a half characters — and
            `Starters · QB/TE` is sixteen. See `tileScope` for which half a phone
            keeps and why. */}
        <p className="m-0 mt-px min-h-[0.6875rem] truncate font-mono text-[length:var(--fs-9)] uppercase leading-[1.2] tracking-[0.06em] text-readout-label sm:text-[length:var(--fs-10)] sm:tracking-[0.12em]">
          <span className="sm:hidden">{scope.phone}</span>
          <span className="hidden sm:inline">{scope.wide}</span>
        </p>
      </div>

      <div className="relative mt-auto pt-[5px] sm:pt-2">
        {/* A computed colour, so it goes through `style` — the ramp is
            continuous and there is no utility class to generate for it. */}
        <p
          className="m-0 truncate font-display font-semibold leading-none tracking-[-0.025em] tabular-nums"
          style={{
            color: tone,
            // **Struck into the glass rather than printed on it**: a lit lip
            // along the top of every stroke and four dark steps under it,
            // which is `--chrome-extrude-shadow`'s grammar at readout scale.
            // The figure keeps its ramp colour and gains its weight from the
            // light catching the cut rather than from a second hue — which is
            // the only way to make it heavier without spending the card's one
            // remaining colour. The static layers are a token because they
            // *invert* for light mode (the lip goes dark, the steps go light);
            // the halo is a continuous ramp value with no utility to generate,
            // so it composes onto the end of the same comma list.
            textShadow: `var(--figure-engrave), 0 0 22px ${rankColor(percentile, 0.4)}`,
          }}
        >
          {/* **The flask takes the wait and the em dash keeps the absence**,
              which is the one distinction this window could not draw before:
              `parts` is null both while the read is in flight and when there is
              genuinely nothing to rank — an all-zero metric, a league too small
              — and an em dash said both. It is the app's spelling of *no
              answer*, so it stays where that is what is meant.

              34px against the figure's `--fs-32` (37px), which is near enough
              to hold the four windows on one baseline without touching
              `mt-auto`. The meter under it keeps drawing its empty track and
              both label lines keep their reserved heights, so nothing on the
              card moves when the rank arrives. */}
          {pending && !parts ? (
            <BubblingFlask size={34} phase={phase} label="Loading rank" />
          ) : (
            <span className="text-[length:var(--fs-24)] sm:text-[length:var(--fs-32)]">
              {parts ? parts.figure : "—"}
            </span>
          )}
          {parts && (
            <span className="text-[length:var(--fs-11)] font-normal tracking-normal opacity-55 sm:text-[length:var(--fs-15)]">
              {parts.suffix}
            </span>
          )}
        </p>
        <span
          aria-hidden
          className="mt-[5px] block h-0.5 rounded-full bg-[color:var(--glass-meter-track)] sm:mt-[0.8125rem]"
        >
          <span
            className="block h-0.5 rounded-full"
            style={{ width: `${fill}%`, background: tone }}
          />
        </span>
      </div>
    </div>
  );
}

/**
 * A window's second line: what was counted, and — where the column narrows —
 * which positions it was counted over.
 *
 * The first half is the scope for a projections or capital column and the board
 * a KeepTradeCut column actually read for *this* league. **Resolved rather than
 * echoed**, which is the difference between a reading and a setting: a column
 * left on `Auto` still priced against one market and one QB board, and a tile
 * that said "Auto" would leave the reader to work out which — while the same two
 * pure functions the route priced the number with are right here, on a card that
 * knows its own league. A second spelling of either rule is a label naming a
 * board the figure under it was not read on.
 *
 * The second half is the narrowing, `slotsLabel` then `positionsLabel`, both
 * slash-joined and never in press order — the same strings the picker's bay
 * prints, so the control and the tile cannot describe one column two ways. The
 * seats come first because they come first in the reading: a slot picks which
 * starting seats are counted and a position picks who, in them, is counted.
 *
 * **They do not both fit on a phone, and which one goes is the whole of why
 * this returns a pair.** At 390 the label box is 65px and this line runs at
 * `--fs-9`, which is about ten and a half characters; `Starters · QB/TE` is
 * sixteen and `Dyn·SF · QB/TE` fourteen. Truncated, what a reader loses is the
 * *tail* — the narrowing, which is both the newer fact and the one that most
 * changes the figure under it, where the scope is at least implied by the unit
 * above. So a narrowed column keeps its narrowing alone below `sm` and the
 * whole line from `sm` up, where the box is ~225px and sixteen characters is
 * comfortable. A column narrowed both ways can still outrun a phone —
 * `FLEX/SF · WR` is twelve — and truncates there, which is the same trade one
 * clause deeper rather than a new one. An un-narrowed column is unchanged at every width, which is
 * every column any existing reader holds.
 */
function tileScope(
  column: LineupColumn,
  league: ManagerLeague,
): { wide: string; phone: string } {
  const ktc = isKtcMetric(column.metric);
  const board = ktc
    ? ktcBoardLabel(
        // `leagueType` rather than a read of `settings.type`, on that helper's
        // own terms: Sleeper omits the field on a standard redraft league, and a
        // second copy of that fallback is a second chance to forget it — here it
        // would be a tile reading `Dyn` over a redraft league's number.
        resolveKtcFormat(column.format, leagueType(league)),
        resolveKtcLineup(column.lineup, league.roster_positions),
      )
    : // **A capital tile names its board only where the reader forced one**,
      // which is where it parts company with the KeepTradeCut arm above and the
      // reason is the line rather than the principle. A KTC tile's scope is
      // already in its unit (`KTC start`), so this line is empty and the board
      // pair has it to itself; a capital tile's line is the scope, and
      // `Starters·1QB` is twelve characters against a phone's ten and a half.
      // An `auto` capital column reads the league's own board, which is what
      // every capital column read before the axis existed — so its tile is
      // byte-identical to the one it always drew, and the board appears exactly
      // when it is the thing telling two capital tiles apart.
      column.lineup === "auto"
      ? ""
      : qbBoardWord(column.lineup === "sf");

  // **The seats replace the scope word rather than following it**: `FLEX/SF`
  // already says these are starting seats, where `Starters · FLEX/SF` spends a
  // third of a 65px line saying it twice. A KeepTradeCut tile has no scope word
  // to replace — its line is the board pair — so the seats join it spaced, and
  // a forced capital board joins tight, which is the same distinction this line
  // already draws between a reading and a narrowing about it.
  const seats = slotsLabel(column.slots);
  const counted = seats || LINEUP_METRIC_LABELS[column.metric].scope;
  const head = ktc
    ? seats
      ? `${board} · ${seats}`
      : board
    : board
      ? `${counted}·${board}`
      : counted;

  const narrowed = positionsLabel(column.positions);
  // The narrowing alone, seats then the players in them — the half a phone
  // keeps. It is one string here and in the wide arm, so the two cannot come to
  // join the two axes differently.
  const narrowing =
    seats && narrowed ? `${seats} · ${narrowed}` : seats || narrowed;
  if (!narrowed) return { wide: head, phone: narrowing || head };
  return {
    wide: head ? `${head} · ${narrowed}` : narrowed,
    phone: narrowing,
  };
}

