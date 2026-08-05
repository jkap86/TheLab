"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Avatar, PositionBadge } from "@/features/shared";

import { useSubjectFilters } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerLeaguemates } from "../hooks/use-manager-leaguemates";
import { useManagerPlayers } from "../hooks/use-manager-players";
import {
  type Subject,
  type SubjectMatch,
  type SubjectOption,
  removeSubjectAt,
  searchSubjects,
  subjectKey,
  subjectOptions,
  toggleSubject,
} from "../subjects";
import { ListLedge } from "./list-ledge";
import { MatchToggle, SubjectToken } from "./subject-parts";

/**
 * The shares sheet, loaded the first time it is opened.
 *
 * It is the Players tab's whole apparatus — the share cards, the metric
 * catalogue, the columns editor behind the heading rail, the ADP board — none of
 * which is on screen until the key is pressed, and none of which the Leagues tab
 * would otherwise parse at all. `ssr: false` for the reason the columns editor
 * takes it: a dialog nobody has opened has no server-rendered state worth having.
 */
const PlayerSharesSheet = dynamic(
  () => import("./player-shares-sheet").then((m) => m.PlayerSharesSheet),
  { ssr: false },
);

/**
 * How many results a panel over the list can show without becoming the list.
 *
 * Becoming the list is what the *shares* key is for, and that is now a sheet
 * over the page rather than a taller panel — see {@link PlayerSharesSheet}.
 */
const RESULT_LIMIT = 8;

/**
 * The list's header rail, carrying the *who is in it* filter above the column
 * headings.
 *
 * **This is the whole of that feature's chrome, and it is one storey of the
 * headings billet rather than a row of its own** — see {@link ListLedge} for why
 * a separate part is the expensive way to draw this. What rides here is a
 * caption, the chosen subjects as tokens, and two slots that open the panel —
 * the search, and the shares browse; the count of what survives sits at the far
 * end, where the rail's own answer belongs.
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
 * **The shares key is a second door onto the same selection, and it opens a
 * sheet rather than this panel.** Typing is only one way to arrive at a name: the
 * players a reader narrows by are mostly the ones they hold everywhere, and that
 * is a list worth *reading* rather than picking blind from — which a floating
 * panel cannot do, because a name and a count is all it has room to say. So the
 * browse is {@link PlayerSharesSheet}: the Players tab's own list, with its four
 * pickable columns and the league filters, laid over the page it narrows. What
 * the two doors still share is the thing that matters — a player picked by
 * browsing leaves exactly the token a player picked by typing does.
 */
export function SubjectRail({
  view,
  headings,
}: {
  view: FilteredLeagues;
  /** The column headings, where the list has rows to head. */
  headings?: React.ReactNode;
}) {
  const { subjects, setSubjects } = useSubjectFilters();
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Latched rather than gated on `sheetOpen`, so closing doesn't unmount the
  // dialog inside its own close handler — and so a second press is instant.
  const [everOpened, setEverOpened] = useState(false);
  if (sheetOpen && !everOpened) setEverOpened(true);
  const [query, setQuery] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const leagues = view.data?.leagues ?? null;
  const selfId = view.data?.user.user_id ?? "";
  // Both halves are fetched whenever the panel is up: the search is one field
  // over both kinds, so opening it with only the rosters loaded would silently
  // answer half the question. The sheet asks for the rosters under the same key.
  const rosters = useManagerPlayers(view.searched, leagues, open);
  const members = useManagerLeaguemates(view.searched, leagues, open);

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

  /** What a selected subject is called — resolved from the same option list. */
  const nameOf = useCallback(
    (subject: Subject) =>
      options.find((o) => subjectKey(o.subject) === subjectKey(subject)),
    [options],
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
  const total = view.leagueFiltered.length;

  return (
    <div ref={boxRef}>
      <ListLedge
        headings={headings}
        storey={
          <>
            {/* Dropped below `sm`, where the row is already wrapping: the
                trigger beside it says "Player or leaguemate" until something is
                picked, so the caption is the one part of the storey a phone can
                lose without the row stopping making sense. */}
            <span className="hidden shrink-0 pl-1 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/55 sm:inline">
              Who&apos;s in it
            </span>

            {/* The tokens: the selection restated where it was made, each its own
                way off. They come before the trigger rather than after it so the
                row reads left to right as caption, selection, add. */}
            {subjects.subjects.map((subject, i) => {
              const option = nameOf(subject);
              return (
                <SubjectToken
                  key={subjectKey(subject)}
                  subject={subject}
                  option={option ?? null}
                  onRemove={() => setSubjects(removeSubjectAt(subjects, i))}
                />
              );
            })}

            {/* The trigger is a slot cut into the storey's face — the same
                channel the headings below sit in, which is this app's answer to
                making a small label read as a part rather than as text. */}
            <button
              type="button"
              onClick={() => {
                // Focusing in the same tick the panel mounts is a frame early;
                // the panel's own effect takes it instead.
                if (open) close();
                else setOpen(true);
              }}
              aria-expanded={open}
              aria-haspopup="dialog"
              className="lab-ledge-slot flex shrink-0 items-center gap-1.5 rounded-[3px] px-2 py-[3px] text-[10px] font-semibold text-foreground/70 transition-colors hover:text-active"
            >
              <SearchIcon />
              {count > 0 ? "Add" : "Player or leaguemate"}
            </button>

            {/* The second door: the whole ranked list, over the page, with what
                is worth knowing about each name on it. The panel closes behind
                it — two floating things over one list, one of them covering the
                other, is two answers to "where am I". */}
            <button
              type="button"
              onClick={() => {
                close();
                setSheetOpen(true);
              }}
              aria-haspopup="dialog"
              className="lab-ledge-slot flex shrink-0 items-center gap-1.5 rounded-[3px] px-2 py-[3px] text-[10px] font-semibold text-foreground/70 transition-colors hover:text-active"
            >
              <SharesIcon />
              {count > 0 ? "Shares" : "Player shares"}
            </button>

            {/* The rail's own answer. Dimmed while the maps behind a selection
                are still being read, since the number is briefly zero and a
                confident zero is worse than an obviously pending one. */}
            <span
              className={`ml-auto shrink-0 pr-1 font-mono text-[10px] tabular-nums ${
                view.subjectsLoading ? "text-foreground/25" : "text-foreground/55"
              }`}
            >
              {count > 0 ? `${view.filtered.length} of ${total}` : `${total}`}
            </span>
          </>
        }
        panel={
          open && (
            <SubjectPanel
              inputRef={inputRef}
              query={query}
              onQuery={setQuery}
              results={results}
              selected={subjects.subjects}
              match={subjects.match}
              onMatch={(match) => setSubjects({ ...subjects, match })}
              onToggle={(subject) => setSubjects(toggleSubject(subjects, subject))}
              loading={!rosters.data && !members.data}
              error={rosters.error ?? members.error}
            />
          )
        }
      />

      {everOpened && (
        <PlayerSharesSheet
          view={view}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
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
