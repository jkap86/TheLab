"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import {
  type Subject,
  type SubjectKind,
  type SubjectMatch,
  type SubjectOption,
  removeSubjectAt,
  searchSubjects,
  subjectKey,
  subjectOptions,
  toggleSubject,
} from "../subjects.ts";
import type { SubjectView } from "../subject-view.ts";
import { useManagerLeaguemates } from "../use-manager-leaguemates";
import { useManagerPlayers } from "../use-manager-players";
import { useReturnFocus } from "../use-return-focus";

import { Avatar } from "./avatar";
import { LeagueFiltersPlaceholder } from "./league-filters-seat";
import { PositionBadge } from "./position-badge";
import { MatchToggle, SubjectToken } from "./subject-parts";

/**
 * The two shares sheets, each loaded the first time it is opened.
 *
 * One is the Players tab's whole apparatus and the other the Leaguemates tab's —
 * the share cards, the metric catalogue, the columns editor behind the heading
 * rail, and for the players one the ADP board — none of which is on screen until
 * a key is pressed, and none of which the Leagues tab would otherwise parse at
 * all. `ssr: false` for the reason the columns editor takes it: a dialog nobody
 * has opened has no server-rendered state worth having.
 *
 * **Two `dynamic()` calls rather than one shell imported once**, because the seam
 * worth splitting is the one a reader actually stops at: most open one browse and
 * never the other, and the players half carries the whole ADP apparatus the
 * leaguemates half has no column for. Measured, that is 6.8KB and 6.5KB against
 * ~9KB for a single chunk holding both.
 *
 * The cost is that {@link SharesSheet} is inlined into *each* of them — webpack
 * does not hoist a module shared by two async chunks into a third — so a reader
 * who opens both pays for the shell twice. That is the right way round: it is
 * ~4KB duplicated for the minority who browse both, against ~2KB of dead
 * catalogue and reads for everyone who browses one. Worth re-measuring if the
 * shell ever grows into the larger half of a chunk.
 */
const PlayerSharesSheet = dynamic(
  () => import("./shares/player-shares-sheet").then((m) => m.PlayerSharesSheet),
  { ssr: false },
);

const LeaguemateSharesSheet = dynamic(
  () =>
    import("./shares/leaguemate-shares-sheet").then(
      (m) => m.LeaguemateSharesSheet,
    ),
  { ssr: false },
);

/**
 * The league filters, loaded the first time this rail renders a list to narrow.
 *
 * It moved here from {@link LeaguesViewLayout}, where it was seated in the
 * header plate's bottom-right corner. Nothing about the split changed with it:
 * the component *is* a trigger and a `<dialog>`, so the seam is the whole of it,
 * and the fallback holds the key's exact box until the chunk lands — which
 * matters more on this row than it did in that corner, since everything to the
 * right of the key is laid out against its width.
 *
 * The module path is named directly rather than the `@/features/shared` barrel,
 * which is the half of this that is invisible in review: re-exported from there
 * the dialog joins the static graph of every page importing anything from that
 * barrel, and this `dynamic()` would be deferring bytes the browser had already
 * been sent. The *placeholder* comes off the barrel, which is the whole point of
 * their being two modules.
 */
const LeagueFiltersModal = dynamic(
  () => import("./league-filters-modal").then((m) => m.LeagueFiltersModal),
  {
    ssr: false,
    loading: () => <LeagueFiltersPlaceholder label="Filters" seat="rail" />,
  },
);

/**
 * How many results a panel over the list can show without becoming the list.
 *
 * Becoming the list is what the *shares* key is for, and that is now a sheet
 * over the page rather than a taller panel — see {@link PlayerSharesSheet}.
 */
const RESULT_LIMIT = 8;

/**
 * The page's filter row: what these leagues *are*, then who is *in* them, then
 * what survives — as a part of its own above the column headings.
 *
 * **It carries both selections now, and the league filters' key leading it is
 * the change.** That key was machined into the header plate's bottom-right
 * corner: 20px tall, at the smallest type on the card, under the countdown, in
 * the corner diagonally furthest from the list it narrows. What made it hard to
 * find was not its size but its company — three of that plate's four corners are
 * readouts, so the one control on it was seated among facts, while the row
 * directly below was already a filter row with an obvious hole at its leading
 * end. The two questions are siblings ("dynasty superflex leagues" / "leagues
 * holding Bijan"), they are applied one after the other in
 * {@link useFilteredLeagues}, and the plate's own scope line has always named
 * them in that order. So the row now reads in it too.
 *
 * They stay **two controls** rather than becoming one dialog with two tabs, for
 * the reason the ADP board is a third control elsewhere again: a league rule is
 * an attribute of the league and a subject is a person or player in it, and one
 * dialog over both would suggest a single selection. What is shared is the
 * *surface*, which is what a reader was looking for.
 *
 * A seam parts the key from the subjects, the same groove that already parts the
 * count from the two doors — three groups on one face, told apart by machining
 * rather than by spacing, since the row wraps below `sm` and spacing does not
 * survive a wrap.
 *
 * **It used to be the upper storey of the headings billet, and what it cost
 * there was legibility rather than pixels.** One billet pays for one wall, one
 * cast shadow and one lot of clearance, which is a real saving and was the whole
 * argument for stacking the two — but a storey and a heading rail are the same
 * material at the same width with a 1px seam between them, so the pinned region
 * read as one crowded instrument three faces deep and the filter read as part of
 * the table's own head. It is not: the headings name what a row *says*, this
 * names which rows there *are*.
 *
 * **So it is a slab, and the material is the separation.** `.lab-slab` is the
 * trades board's block — a wall running down *and* right, graded from a lit near
 * corner to a dark far one, brushed face, chamfers on all four corners against
 * the billet's two. Nothing else in the pinned region has a wall on two sides,
 * which is what makes this read as an object sitting above the rail rather than
 * as more of it. It wears `.lab-slab-fixed` because it is a surface holding
 * controls and not a card: the lift and the brightening bloom belong to a part
 * you press, and this one you press *into*.
 *
 * The wrapper is the heading billet's own geometry, so the two parts share a
 * left edge and stack rather than merely following one another; the face stops
 * 6px short on the right, which is the wall and is the point.
 *
 * What rides on it is a caption, the chosen subjects as tokens, the search slot,
 * and — at the far end — the count of what survives and the two doors onto the
 * ranked lists.
 *
 * Five decisions worth keeping:
 *
 * **It commits live, and that is what taking it out of the filters dialog
 * bought.** There is no draft to protect here, because there is no per-option
 * count that has to be read against a still list — a result row states how many
 * leagues hold *that* subject, which is true whatever else is selected. So a
 * press narrows immediately and the count a few pixels away moves with it.
 *
 * **One search over both kinds.** Players and leaguemates are the same question —
 * who is in this league — and two fields would make a reader decide which one
 * they meant before typing a name that only exists in one of them. The results
 * are grouped, so the answer still says which it found.
 *
 * **The lists are fetched on open, not on mount.** They are the other two tabs'
 * resources off a cache shared per manager, so a reader who has visited either
 * pays nothing and a tab this control is never opened on costs no request. The
 * narrowing in {@link useFilteredLeagues} asks for the same two query keys once a
 * subject is selected, and the cache is what makes those one request rather than
 * two.
 *
 * **The options are counted over the leagues the *other* filters leave.** Counted
 * over the subject selection itself a menu collapses to what is already picked
 * the moment anything is picked, and cannot be widened again without being
 * cleared — the rule the trades board's facets keep, for the same reason.
 *
 * **The shares keys are a second door onto the same selection, and they open a
 * sheet rather than this panel.** Typing is only one way to arrive at a name: the
 * subjects a reader narrows by are mostly the ones they hold or play everywhere,
 * and that is a list worth *reading* rather than picking blind from — which a
 * floating panel cannot do, because a name and a count is all it has room to say.
 * So the browse is {@link PlayerSharesSheet} or {@link LeaguemateSharesSheet}: the
 * matching tab's own list, with its four pickable columns and the league filters,
 * laid over the page it narrows. What every door shares is the thing that matters
 * — a subject picked by browsing leaves exactly the token one picked by typing
 * does.
 *
 * **They are drawn as raised keys at the trailing end, where the search is a
 * channel at the leading one, and both halves of that were one bug.** All three
 * used to be `.lab-ledge-slot` in one adjacent run, which is a segmented text
 * input in every respect a reader judges by — same material, same size, no
 * divider — so the two that throw a sheet over the page were being offered as
 * somewhere else to type. Material says what a part *is* (a channel becomes a
 * field, a pill is pressed) and seating says what it belongs *with* (the count
 * and the keys describe the population; the field is the reader's own input).
 * Material is the half that survives a phone, since the storey wraps down there
 * and the two ends become two lines.
 *
 * **There is a key per kind, where the search is one field over both.** Those are
 * opposite halves of one argument rather than an inconsistency. A reader *typing*
 * a name already knows which kind it is, so making them pick a field first is a
 * question with no purpose. A reader *browsing* has arrived with a question — "who
 * do I hold" and "who do I play against" are two of them — and one merged list
 * ranked by leagues held would answer neither: the columns differ (a person has no
 * board price), and several hundred players would bury several hundred people
 * whichever way it sorted.
 */
export function SubjectRail({ view }: { view: SubjectView }) {
  const { subjects, setSubjects } = view;
  const [open, setOpen] = useState(false);
  /**
   * Which browse is up, if either.
   *
   * One value rather than a flag apiece: both are modal, so two open at once is
   * unrepresentable rather than merely avoided — and the rail is behind whichever
   * is up, so a reader cannot reach the other key to try.
   */
  const [sheet, setSheet] = useState<SubjectKind | null>(null);
  /**
   * Which have ever been opened — latched, so closing doesn't unmount a dialog
   * inside its own close handler and a second press is instant.
   *
   * Latched *per kind* rather than once for both, because mounting is what
   * downloads the chunk: a reader who only ever browses players must not pay for
   * the leaguemates list's catalogue and reads.
   */
  const [mounted, setMounted] = useState<readonly SubjectKind[]>([]);
  if (sheet && !mounted.includes(sheet)) setMounted([...mounted, sheet]);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  // The panel takes the focus on mount, so Escape — which closes it from a
  // document listener below — takes the focused input with it.
  useReturnFocus(open, searchTrigger);

  const leagues = view.leagues;
  const selfId = view.userId ?? "";
  // Both halves are fetched whenever the panel is up: the search is one field
  // over both kinds, so opening it with only the rosters loaded would silently
  // answer half the question. The sheet asks for the rosters under the same key.
  const rosters = useManagerPlayers(view.searched, view.userId, leagues, open);
  const members = useManagerLeaguemates(view.searched, view.userId, leagues, open);

  const options = useMemo(
    () =>
      subjectOptions(
        view.leagueFiltered,
        {
          rosters: rosters.data?.rosters ?? {},
          members: members.data?.members ?? {},
        },
        rosters.data?.players ?? {},
        members.data?.users ?? {},
        selfId,
      ),
    [view.leagueFiltered, rosters.data, members.data, selfId],
  );

  const results = useMemo(
    () => searchSubjects(options, query, RESULT_LIMIT),
    [options, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  // A press outside the rail dismisses the panel. Pointer-down rather than
  // click, so dragging out of it doesn't leave it up — the same gesture the
  // filters dialog's segment rows and the ADP drawer's floats answer to.
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open, close]);

  // Escape closes the innermost thing that is up, which here is the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const count = subjects.subjects.length;
  /**
   * What the row is counted against, and it is the *account* rather than the
   * league-filtered list it used to be.
   *
   * With only the subject filter on this rail, `N of M` meant "of the leagues
   * the other control left" — honest, and it named a population stated nowhere
   * on screen. Both controls sit here now, so the denominator is the whole
   * account and the numerator is what the two of them leave between them: one
   * number answering the row it is on. The plate's corner tab states the same
   * total, which is where a reader sees what this is out of.
   */
  const total = leagues?.length ?? 0;
  const narrowed = view.filtered.length !== total;
  // The unfiltered list, which the dialog's per-option counts are over — and the
  // condition the key is drawn under, which is the one the header plate applied
  // when it held the key: an account with no leagues has nothing to narrow.
  const allLeagues = leagues;

  return (
    <div ref={boxRef}>
      {/* The heading billet's own wrapper geometry, so the two parts share a
          left edge rather than each finding its own — see {@link ListLedge},
          which spends the same 1px transparent border the cards do.

          It is `relative` for the reason that one is: `clip-path` clips a whole
          subtree, so the chamfered slab would cut the search panel off at its
          own edge. The panel is a sibling of the slab, hung off this box. */}
      <div className="relative border border-transparent px-4 pl-5">
        {/* Wall wrapper and lit face, both chamfered — a wall that turns four
            corners shows a square one wherever the clip doesn't follow it. */}
        <div className="lab-slab lab-slab-fixed lab-notch-all">
          {/* It **wraps rather than compresses**: at 390px a caption, a token,
              a trigger and the count do not fit on one line, and everything in
              the row is content rather than chrome — so it takes a second line
              down there instead of pushing the count off the end of the part. */}
          <div className="lab-slab-face lab-slab-face-rail lab-notch-all flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-2.5 py-1.5">
            {/* The first group: what these leagues *are*.

                It leads because that is the order the two narrowings are
                applied in and the order the plate's scope line names them — and
                because it is the only one of the two that answers on a cold
                page, before any roster or membership map has been read.

                `seat="rail"` is the two keys at the other end of this row,
                exactly: same pill, same 10px, same thin wall. A filter key a
                step larger than the parts beside it would be the only thing on
                this face claiming a rank, which is a claim about *controls*
                where the row's own hierarchy is about *questions*. */}
            {allLeagues && allLeagues.length > 0 && (
              <>
                {/* **The wrapper is what closes the search panel, and it is
                    needed because the key moved *inside* this rail's box.** The
                    panel dismisses on a pointer-down outside `boxRef`, which is
                    how every other control on the page takes it down; the two
                    shares keys sit inside that box too and call `close()`
                    themselves for the same reason. Without this the dialog would
                    open over a panel still mounted underneath it — two floating
                    things over one list, which is the state this rail is careful
                    not to reach.

                    Pointer-down rather than click, matching the gesture the
                    dismissal itself listens for, so the panel is gone before the
                    dialog arrives rather than a frame after it.

                    A wrapper rather than a callback on the dialog because that
                    component owns its own open state and exposes no `onOpen` —
                    and adding one would be a prop the trades page has no use
                    for. It shrink-wraps the key, so the row's layout is what it
                    would be with the key loose in it. */}
                <span className="flex shrink-0" onPointerDown={close}>
                  <LeagueFiltersModal
                    filters={view.filters}
                    onChange={view.setFilters}
                    leagues={allLeagues}
                    seat="rail"
                  />
                </span>
                <RailSeam />
              </>
            )}

            {/* Dropped below `sm`, where the row is already wrapping: the
                trigger beside it says "Player or leaguemate" until something is
                picked, so the caption is the one part of the row a phone can
                lose without it stopping making sense.

                It sits *after* the key rather than opening the row, which is
                what makes it true: it captions the group it introduces, and the
                group before it has a key naming itself. */}
            <span className="hidden shrink-0 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/55 sm:inline">
              Who&apos;s in it
            </span>

            {/* The tokens: the selection restated where it was made, each its own
                way off. They come before the trigger rather than after it so the
                row reads left to right as caption, selection, add.

                Named through `subjectDisplay` rather than off the option list
                beside them, so this rail and both sheets read one definition of
                what a token says — see the note on that resolver for why the
                option list cannot be it. */}
            {subjects.subjects.map((subject, i) => (
              <SubjectToken
                key={subjectKey(subject)}
                subject={subject}
                label={view.subjectDisplay(subject)}
                onRemove={() => setSubjects(removeSubjectAt(subjects, i))}
              />
            ))}

            {/* The trigger is a slot milled into the slab's face, which is this
                app's answer to making a small label read as a part rather than
                as text.

                **`.lab-channel` rather than the heading rail's
                `.lab-ledge-slot`, because a cut is read against the face it is
                cut into.** That one is tuned for the ledge's *light* face and
                gets lighter towards its bottom, which reads as a deep slot
                there and as a raised sliver on a face this dark; the channel is
                near-black with a cyan hairline ring, which is what the app bar's
                own block cuts into a face of almost exactly these tones.

                **It is the only part of this row that is recessed, and that is
                the material rule rather than a leftover.** Recessed is what this
                app draws for a field or a readout; this trigger *becomes* a text
                field a frame after it is pressed, so a slot is the honest thing
                for it to look like beforehand. The two keys below open a dialog
                and are never fields, so they wear the raised pill — see the note
                on them. All three used to wear one class, which made the row read
                as one segmented input with three cells: the eye groups by
                material before it reads a word, so the two doors onto a whole
                ranked list were being offered as somewhere else to type. */}
            <button
              ref={searchTrigger}
              type="button"
              onClick={() => {
                // Focusing in the same tick the panel mounts is a frame early;
                // the panel's own effect takes it instead.
                if (open) close();
                else setOpen(true);
              }}
              aria-expanded={open}
              // What opens is a search panel hanging off the rail, not a dialog:
              // it traps nothing, the page behind it stays live, and announcing
              // "dialog" promised a modal that never arrives. The key beside it
              // *does* open one, and keeps the attribute.
              aria-controls={open ? panelId : undefined}
              className="lab-channel flex shrink-0 items-center gap-1.5 rounded-[3px] px-2 py-[3px] text-[10px] font-semibold text-foreground/70 transition-colors hover:text-active"
            >
              <SearchIcon />
              {count > 0 ? "Add" : "Player or leaguemate"}
            </button>

            {/* The trailing end: what the rail answers, and the two doors onto
                the lists behind that answer.

                **They are one flex item, and that is what keeps them at the
                trailing edge on a line they had to wrap onto.** An `ml-auto` is
                resolved per flex line, so leaving these loose put them at the
                right of the first line and hard against the *left* of the second
                — where the storey wraps below `sm`, which is the width the
                grouping matters at most. Wrapped whole, the group carries its own
                auto margin down with it. It wraps internally rather than
                compressing, for the storey's own reason.

                **What they have in common is that all three describe the
                population**, where the field before them is the reader's own
                input: the count says how many leagues are left, and the keys are
                the two ranked lists of who is in them. That is what earns the
                seating — the same argument that put the ADP block beside Tools
                rather than beside the page chip. */}
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-1">
              {/* The rail's own answer. Dimmed while the maps behind a selection
                  are still being read, since the number is briefly zero and a
                  confident zero is worse than an obviously pending one. */}
              {/* The rail commits live, so this number is the whole feedback a
                  press on a result gives. `sr-only` says what it counts: on
                  screen the list under it is the context, and read aloud on its
                  own "19 of 121" names nothing. */}
              {/* Narrowed by *either* control, since both are on this row now.
                  Unnarrowed it is the bare total: a denominator restating its own
                  numerator is the thing the plate keeps having to relearn. */}
              <span
                role="status"
                className={`shrink-0 pl-1 font-mono text-[10px] tabular-nums ${
                  view.subjectsLoading ? "text-foreground/25" : "text-foreground/55"
                }`}
              >
                {narrowed ? `${view.filtered.length} of ${total}` : `${total}`}
                <span className="sr-only"> leagues</span>
              </span>

              <RailSeam />

              {/* The other two doors: the whole ranked list of each kind, over
                  the page, with what is worth knowing about every name on it. The
                  panel closes behind either — two floating things over one list,
                  one of them covering the other, is two answers to "where am I".

                  **A raised pill, not the search's channel**, and it is the
                  app's own grammar rather than a way of telling three parts
                  apart: raised is what a control that opens something wears
                  everywhere else here. `lab-chip lab-chip-sm rounded-full` is the
                  ADP drawer's smallest key, so this borrows a spelling rather
                  than inventing one, and the pair picks up the press travel a
                  channel has none of. The text hover is the chips' own
                  (`hover:text-foreground`, with the face lightening under it) and
                  deliberately not the slots' `hover:text-active` — the accent
                  belongs to a control that is *narrowing* something, which a
                  door onto a list never is.

                  The label spells out what the sheet holds at rest and contracts
                  once there are tokens crowding the row, exactly as the search
                  trigger does: the icon is what still tells the pair apart. */}
              <button
                type="button"
                onClick={() => {
                  close();
                  setSheet("player");
                }}
                aria-haspopup="dialog"
                className="lab-chip lab-chip-sm flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-semibold text-foreground/75 transition-colors hover:text-foreground"
              >
                <SharesIcon />
                {count > 0 ? "Players" : "Player shares"}
              </button>

              <button
                type="button"
                onClick={() => {
                  close();
                  setSheet("leaguemate");
                }}
                aria-haspopup="dialog"
                className="lab-chip lab-chip-sm flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-semibold text-foreground/75 transition-colors hover:text-foreground"
              >
                <MatesIcon />
                {count > 0 ? "Leaguemates" : "Leaguemate shares"}
              </button>
            </div>
          </div>
        </div>

        {open && (
          <SubjectPanel
            id={panelId}
            inputRef={inputRef}
            query={query}
            onQuery={setQuery}
            results={results}
            selected={subjects.subjects}
            match={subjects.match}
            onMatch={(match) => setSubjects({ ...subjects, match })}
            onToggle={(subject) => setSubjects(toggleSubject(subjects, subject))}
            // Loading until *each* read has settled — with data or with an
            // error — never "until either lands". The search is one field over
            // both kinds, so a panel that reported settled on the faster read
            // answered half the question with confidence: a leaguemate name
            // typed while only the rosters were in drew "Nobody by that name",
            // which is exactly what fetching both up front exists to prevent.
            // The error halves keep a failed read from hanging the panel on
            // "Reading rosters…" and swallowing the error line below it.
            loading={
              (!rosters.data && !rosters.error) || (!members.data && !members.error)
            }
            error={rosters.error ?? members.error}
          />
        )}
      </div>

      {/* `onClose` clears only its own kind: a sheet closing is the last thing
          that happens on the way out of it, and clearing the state flatly would
          have one dialog's exit cancel whatever had just been asked for. */}
      {mounted.includes("player") && (
        <PlayerSharesSheet
          view={view}
          open={sheet === "player"}
          onClose={() => setSheet((s) => (s === "player" ? null : s))}
        />
      )}

      {mounted.includes("leaguemate") && (
        <LeaguemateSharesSheet
          view={view}
          open={sheet === "leaguemate"}
          onClose={() => setSheet((s) => (s === "leaguemate" ? null : s))}
        />
      )}
    </div>
  );
}

/**
 * A groove between two groups of parts on the rail's face — the ledge seam's
 * rule stood on end, a dark cut with a lit far wall.
 *
 * Both halves are spelled out because there is no vertical spelling of
 * `.lab-ledge-seam`, and one shadow alone is a border rather than machining. It
 * is a component rather than two copies of that pair because the row now has two
 * of them, and two spellings of one piece of machining is one edit away from a
 * face with a groove on one side and a rule on the other.
 */
function RailSeam() {
  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-px shrink-0 bg-[rgba(0,0,0,0.5)] shadow-[1px_0_0_rgba(255,255,255,0.09)]"
    />
  );
}

/**
 * The search, floating under the rail.
 *
 * A raised face over the list it narrows — the material grammar everywhere else
 * here: the thing you are working in sits above the thing you are working on. It
 * hangs off the rail's own box rather than pushing the list down, because a panel
 * that moved the rows would be answering the question by moving the answer.
 *
 * It is one field over both kinds with the results grouped, and it stays capped:
 * a panel this size showing three hundred rows is the reason the *browse* is a
 * sheet instead — see {@link PlayerSharesSheet}. What survives here is the door
 * for a reader who already knows the name they want.
 */
function SubjectPanel({
  id,
  inputRef,
  query,
  onQuery,
  results,
  selected,
  match,
  onMatch,
  onToggle,
  loading,
  error,
}: {
  /** The trigger's `aria-controls` target. */
  id: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (value: string) => void;
  results: SubjectOption[];
  selected: readonly Subject[];
  match: SubjectMatch;
  onMatch: (match: SubjectMatch) => void;
  onToggle: (subject: Subject) => void;
  loading: boolean;
  error: string | null;
}) {
  // The panel is opened to be typed into, so it takes the focus on mount rather
  // than leaving the first keystroke to land on the page behind it.
  useEffect(() => {
    inputRef.current?.focus();
  }, [inputRef]);

  const players = results.filter((o) => o.subject.kind === "player");
  const mates = results.filter((o) => o.subject.kind === "leaguemate");
  const chosen = new Set(selected.map(subjectKey));

  return (
    // The input and the match row are pinned; only the results scroll — the
    // drawer's own rule. The scroll box takes no `flex-1` for the usual reason
    // — a short result list should leave a short panel, not stretch to the cap
    // — and `min-h-0` is what lets a long one shrink into it.
    // `overscroll-contain` keeps a flick at its end from carrying on into the
    // page, exactly as the league panel's scroll box does.
    <div
      id={id}
      role="group"
      aria-label="Filter by player or leaguemate"
      className="absolute left-4 right-4 top-full z-30 mt-1.5 flex max-h-[min(60vh,26rem)] flex-col gap-1.5 rounded-xl border border-active/25 bg-gradient-to-b from-[#1b3040] to-[#0d1c27] p-2 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95),0_0_36px_-16px_rgba(0,255,229,0.35)] sm:max-w-[26rem]"
      style={{ animation: "dialog-rise 0.14s cubic-bezier(0.2,0.9,0.3,1)" }}
    >
      <div className="flex shrink-0 items-center gap-2 rounded-lg border border-foreground/10 bg-[#06111b] px-2.5 py-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-within:border-active/60">
        <SearchIcon />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search players and leaguemates"
          aria-label="Search players and leaguemates"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/30"
        />
      </div>

      {error && !loading && (
        <p className="shrink-0 px-2 py-1 text-[11px] text-amber-300">{error}</p>
      )}

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto overscroll-contain">
        {loading ? (
          <p className="px-2 py-2 text-[12px] text-foreground/40">
            Reading rosters…
          </p>
        ) : results.length === 0 ? (
          <p className="px-2 py-2 text-[12px] text-foreground/40">
            {query.trim()
              ? "Nobody by that name in these leagues."
              : "No rosters or members cached for these leagues yet."}
          </p>
        ) : (
          <>
            <ResultGroup
              label="Players"
              options={players}
              chosen={chosen}
              onToggle={onToggle}
            />
            <ResultGroup
              label="Leaguemates"
              options={mates}
              chosen={chosen}
              onToggle={onToggle}
            />
          </>
        )}
      </div>

      {selected.length > 1 && (
        <div className="mt-0.5 flex shrink-0 items-center gap-2 border-t border-foreground/10 px-1 pt-2">
          <MatchToggle match={match} onMatch={onMatch} />
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  options,
  chosen,
  onToggle,
}: {
  label: string;
  options: SubjectOption[];
  chosen: Set<string>;
  onToggle: (subject: Subject) => void;
}) {
  if (options.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <span className="px-1 pt-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/40">
        {label}
      </span>
      {options.map((option) => {
        const key = subjectKey(option.subject);
        const on = chosen.has(key);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.subject)}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-semibold ${
              on
                ? "lab-chip lab-chip-sm lab-chip-on"
                : "lab-chip lab-chip-sm text-foreground/75 hover:text-foreground"
            }`}
          >
            {option.subject.kind === "player" ? (
              <PositionBadge position={option.position} />
            ) : (
              <Avatar url={option.avatarUrl} name={option.name} size="sm" />
            )}
            <span className="min-w-0 flex-1 truncate">{option.name}</span>
            {option.note && (
              <span
                className={`shrink-0 text-[11px] font-medium ${
                  on ? "text-[#052029]/55" : "text-foreground/40"
                }`}
              >
                {option.note}
              </span>
            )}
            <span
              title="Leagues holding this"
              className={`shrink-0 font-mono text-[10px] tabular-nums ${
                on ? "text-[#052029]/60" : "text-foreground/35"
              }`}
            >
              {option.count}
              {/* `title` is a pointer affordance and nothing else — read aloud
                  the row ended in a bare number with no word for it. */}
              <span className="sr-only"> leagues</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </svg>
  );
}

/**
 * Two figures at 12px: the people you play against — the leaguemates tool's own
 * glyph, redrawn on this rail's 16 viewBox rather than scaled off the 24 one.
 *
 * The three icons in this storey are one set, and the tool icons are another
 * (20px, in a menu that is scanned): borrowing across would land a different
 * stroke weight on the same row.
 */
function MatesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="5.5" r="2.4" />
      <path d="M1.8 13.2a4.2 4.2 0 0 1 8.4 0" />
      <path d="M10.6 3.6a2.4 2.4 0 0 1 0 3.9" />
      <path d="M11.5 9.7a4.2 4.2 0 0 1 2.7 3.5" />
    </svg>
  );
}

/** A ranked list at 12px: three bars, longest first — what the shares are. */
function SharesIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M2.5 4h11" />
      <path d="M2.5 8h7.5" />
      <path d="M2.5 12h4.5" />
    </svg>
  );
}
