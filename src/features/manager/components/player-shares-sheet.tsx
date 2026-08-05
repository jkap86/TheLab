"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  LeagueFiltersModal,
  adpQueryString,
  todayIso,
  useAdp,
} from "@/features/shared";
import { usePersistedColumns } from "@/features/shared/use-persisted-columns";

import { useAdpControls, useSubjectFilters } from "../filters-context";
import type { FilteredLeagues } from "../hooks/use-filtered-leagues";
import { useManagerPlayers } from "../hooks/use-manager-players";
import { rankByName } from "../name-search";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
  type ShareMetricContext,
} from "../share-metrics";
import { playerShares } from "../shares";
import {
  type Subject,
  removeSubjectAt,
  subjectKey,
  subjectOptions,
  toggleSubject,
} from "../subjects";
import type { AdpPlayerPayload } from "../types";
import { ColumnsBar } from "./columns-bar";
import { ErrorCard } from "./manager-leagues-status";
import { PlayerShares } from "./player-shares";
import { MatchToggle, SubjectToken } from "./subject-parts";
import { PanelLoading, PanelMessage } from "./ui";

/**
 * The shares browse, as a sheet over the leagues page.
 *
 * It replaces the 26rem panel the *Player shares* key used to drop under the
 * rail, and the thing it replaces is not the list — it is what the list was
 * allowed to say. A name and a count is the table the Players tab was before its
 * columns were pickable, while that tab is one click away carrying exposure,
 * record, win rate, league mix and the board price for exactly these rows. So the
 * sheet is that tab's list, over this one, with the same four pickable columns
 * and the league filters key beside them.
 *
 * Five things are load-bearing.
 *
 * **It is glass, and the glass is spent on the frame.** Everything else in this
 * app is a lit metal face on an opaque ground, so a translucent panel is the one
 * new material here: it is what says the leagues page is still underneath rather
 * than navigated away from, which is what keeps a sheet this size honest about
 * being a control over that page. The rows themselves sit on an opaque well —
 * four numbers a row read over a hundred league cards drifting behind them is the
 * one thing the effect is not allowed to buy.
 *
 * **A native `<dialog>`, and that is what makes the two keys safe.** The filters
 * modal and the columns editor are dialogs of their own opened from inside this
 * one; the platform stacks them in the top layer, closes the innermost on Escape,
 * and — the part a hand-rolled overlay gets wrong — a press inside them never
 * reaches this dialog's own box, so the backdrop-click dismissal below can't fire
 * under them. The rail's panel dismisses on a document `pointerdown` for want of
 * that, which is exactly the listener that would have closed this sheet the moment
 * a filter was pressed.
 *
 * **It commits live.** A row press toggles the subject and the league list behind
 * the glass narrows immediately — there is no draft and no Apply, because a row's
 * count states how many leagues hold *that* player, which is true whatever else is
 * picked. The bar's readout is the same `N of M` the rail carries, so the sheet
 * states its effect where a reader can see it without moving the sheet.
 *
 * **The list is counted over `leagueFiltered`, not over `filtered`.** The menu a
 * selection is made from must not collapse to that selection — the rule
 * {@link subjectOptions} keeps, and the reason the sheet's own denominator can
 * differ from the page's count by design: the numerator is what you picked, the
 * denominator is what you picked it from.
 *
 * **The columns are the Players tab's columns.** Same persisted `share`
 * selection, same catalogue, so aiming a column here aims it there — one board
 * seen twice rather than two that agree until someone changes one.
 */
export function PlayerSharesSheet({
  view,
  open,
  onClose,
}: {
  view: FilteredLeagues;
  open: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const { subjects, setSubjects } = useSubjectFilters();

  const leagues = view.data?.leagues ?? null;
  // Off until the sheet is opened, and the same query key the rail's panel and
  // the Players tab already name — so a reader who has been to either pays
  // nothing, and a reader who never opens this costs no request.
  const rosters = useManagerPlayers(view.searched, leagues, open);

  // The board the ADP columns read, behind the same gate. It is not keyed to the
  // manager, so the drawer and the Players tab share this entry with the sheet.
  const { controls } = useAdpControls();
  const adpQuery = useMemo(
    () => adpQueryString(controls, todayIso()),
    [controls],
  );
  const adp = useAdp(adpQuery, { enabled: open });
  const adpByPlayer = useMemo(() => {
    const map = new Map<string, AdpPlayerPayload>();
    for (const player of adp.data?.players ?? [])
      map.set(player.player_id, player);
    return map;
  }, [adp.data]);

  const shares = useMemo(
    () =>
      rosters.data
        ? playerShares(
            view.leagueFiltered,
            rosters.data.rosters,
            rosters.data.players,
          )
        : null,
    [view.leagueFiltered, rosters.data],
  );

  // The field is live over the whole list rather than capped, which is the point
  // of the browse: what the search panel's top eight leaves out is the tail a
  // reader came here to scroll.
  const rows = useMemo(
    () =>
      shares
        ? rankByName(shares.players, (share) => share.name, query, Infinity)
        : [],
    [shares, query],
  );

  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "share",
    DEFAULT_PLAYER_COLUMNS,
    PLAYER_SHARE_METRICS,
  );

  const chosen = useMemo(
    () => new Set(subjects.subjects.map(subjectKey)),
    [subjects.subjects],
  );

  /**
   * What a selected subject is called, for the tokens.
   *
   * Read off the same options the rail's panel names its rows from, rather than
   * off the shares list: a leaguemate can be selected while this sheet is open,
   * and its token has to keep its name when the population it was picked from
   * isn't the one on screen.
   */
  const options = useMemo(
    () =>
      subjectOptions(
        view.leagueFiltered,
        { rosters: rosters.data?.rosters ?? {}, members: {} },
        rosters.data?.players ?? {},
        {},
        view.data?.user.user_id ?? "",
      ),
    [view.leagueFiltered, rosters.data, view.data?.user.user_id],
  );
  const nameOf = useCallback(
    (subject: Subject) =>
      options.find((o) => subjectKey(o.subject) === subjectKey(subject)) ??
      null,
    [options],
  );

  // The one thing a `<dialog>` can't be told declaratively. `close` fires for
  // Escape and the backdrop alike, so the parent hears every way out through the
  // same handler.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
      // `showModal` autofocuses the first focusable descendant, which here is the
      // filters key — a control wearing a focus ring reads as pressed. The field
      // takes it instead: the sheet is opened to be typed into or scrolled, and
      // the trap and Escape still belong to the dialog.
      inputRef.current?.focus();
    }
  }, [open]);

  // Reopening on a stale query would show a filtered list under an emptied field
  // on the next open otherwise — the field is cleared on the way out, not the
  // way in, so nothing flashes while the sheet is still on screen.
  const close = useCallback(() => {
    setQuery("");
    onClose();
  }, [onClose]);

  const total = view.leagueFiltered.length;
  const picked = subjects.subjects.length;

  return (
    <dialog
      ref={ref}
      aria-labelledby="player-shares-title"
      // **Both handlers test the target, and `onClose` has to.** The filters
      // modal and the columns editor are dialogs *inside* this one, and React
      // walks its own tree for `close` — which does not bubble in the DOM — so
      // an unguarded handler here fires when either of them closes, taking the
      // sheet down with the dialog a reader just dismissed. That is the rule the
      // platform's stacking otherwise gives for free, and the one thing this
      // sheet has to spell out.
      onClose={(event) => {
        if (event.target === ref.current) close();
      }}
      // The backdrop is the dialog's own pseudo-element, so a click landing on
      // the dialog box itself is a click outside the panel.
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
      // A thinner scrim than the other two dialogs wear: this one is meant to be
      // seen through, and at their 0.72 the page behind the glass is gone.
      className="m-auto h-[min(88vh,54rem)] w-[min(1180px,calc(100vw-2rem))] bg-transparent p-0 text-foreground backdrop:bg-[rgba(4,10,16,0.5)]"
    >
      <div
        className="flex h-full flex-col overflow-hidden rounded-2xl border border-active/25 bg-gradient-to-b from-[rgba(24,45,60,0.72)] to-[rgba(9,20,31,0.86)] shadow-[0_50px_90px_-30px_rgba(0,0,0,0.95),0_0_70px_-24px_rgba(0,255,229,0.35),inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl"
        style={{ animation: "dialog-rise 0.18s cubic-bezier(0.2,0.9,0.3,1)" }}
      >
        {/* The panel's specular rail, as the filters dialog and the header plate
            wear — without it a face this large reads as a sheet of glass rather
            than as a milled part made of it. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-active/70 to-transparent"
        />

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-foreground/10 bg-gradient-to-b from-foreground/[0.06] to-transparent px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-4">
          <h2
            id="player-shares-title"
            className="shrink-0 font-display text-sm font-semibold tracking-tight"
          >
            Player shares
          </h2>

          {/* The league filters, in the bar rather than left behind on the page:
              every row's share is out of the leagues the *other* filters leave,
              so narrowing to dynasty rewrites all 981 numbers and reorders the
              list under them. It opens over this sheet, which is the platform's
              own stack — see the note above on why that is safe here. */}
          {leagues && leagues.length > 0 && (
            <LeagueFiltersModal
              filters={view.filters}
              onChange={view.setFilters}
              leagues={leagues}
              seat="bar"
            />
          )}

          <div className="order-last flex min-w-0 flex-1 basis-full items-center gap-2 rounded-lg border border-foreground/10 bg-[#06111b] px-2.5 py-1.5 shadow-[inset_0_2px_4px_rgba(0,0,0,0.6)] focus-within:border-active/60 sm:order-none sm:basis-auto">
            <SearchIcon />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search player shares"
              aria-label="Search player shares"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-foreground/30"
            />
          </div>

          {/* The sheet's own answer, in the words the rail uses for it. Dimmed
              while the maps behind a selection are still being read, since the
              number is briefly zero and a confident zero is worse than an
              obviously pending one. */}
          <span
            className={`ml-auto shrink-0 font-mono text-[11px] tabular-nums sm:ml-0 ${
              view.subjectsLoading ? "text-foreground/25" : "text-foreground/55"
            }`}
          >
            {picked > 0 ? (
              <>
                <b className="font-bold text-active">{view.filtered.length}</b>{" "}
                of {total} leagues
              </>
            ) : (
              `${total} leagues`
            )}
          </span>

          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close"
            className="lab-chip lab-chip-sm grid size-7 shrink-0 place-items-center rounded-full text-foreground/55 transition-colors hover:text-active"
          >
            <CloseIcon />
          </button>
        </div>

        {/* `px-2` on the rail, to the pixel: the ledge is laid on a card's own
            geometry (its border, its `pl-5`), and inside the sheet the cards
            carry the well's padding on top of that. Without the same 8px here
            every heading would sit short of the number it names. */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3 sm:p-4">
          {shares && shares.players.length > 0 && (
            <div className="px-2">
              <ColumnsBar
                metrics={PLAYER_SHARE_METRICS}
                columns={columns}
                subject="Player"
                presets={PLAYER_SHARE_COLUMN_PRESETS}
                ctx={previewContext(shares, adpByPlayer)}
                previewLabel={shares.players[0]?.name ?? null}
                onColumnChange={setColumn}
                onColumns={setColumns}
                onReset={reset}
                storey={
                  // The tokens name themselves and the rows say what a press
                  // does by doing it, so the storey carries no caption and no
                  // instruction: with nothing picked it is the count alone.
                  <>
                    {subjects.subjects.map((subject, i) => (
                      <SubjectToken
                        key={subjectKey(subject)}
                        subject={subject}
                        option={nameOf(subject)}
                        onRemove={() =>
                          setSubjects(removeSubjectAt(subjects, i))
                        }
                      />
                    ))}
                    {picked > 1 && (
                      <MatchToggle
                        match={subjects.match}
                        onMatch={(match) => setSubjects({ ...subjects, match })}
                      />
                    )}
                    <span className="ml-auto shrink-0 pr-1 font-mono text-[10px] tabular-nums text-foreground/55">
                      {rows.length} player{rows.length === 1 ? "" : "s"}
                    </span>
                  </>
                }
              />
            </div>
          )}

          {/* The list's own ground: opaque, so the numbers are never read over
              the page moving behind the glass. `min-h-0` is what lets it shrink
              into the sheet rather than pushing the bar off the top. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-xl bg-[rgba(3,11,18,0.72)] p-2 shadow-[inset_0_2px_6px_rgba(0,0,0,0.65),inset_0_0_0_1px_rgba(255,255,255,0.05)]">
            {rosters.error && !shares ? (
              <ErrorCard message={rosters.error} />
            ) : !shares ? (
              <PanelLoading>Reading rosters…</PanelLoading>
            ) : rows.length === 0 ? (
              <PanelMessage>
                {query.trim()
                  ? "Nobody by that name on these rosters."
                  : "No players rostered in these leagues yet."}
              </PanelMessage>
            ) : (
              <PlayerShares
                shares={rows}
                leagueCount={shares.league_count}
                adp={adpByPlayer}
                columns={columns}
                isSelected={(share) =>
                  chosen.has(
                    subjectKey({ kind: "player", id: share.player_id }),
                  )
                }
                onSelect={(share) =>
                  setSubjects(
                    toggleSubject(subjects, {
                      kind: "player",
                      id: share.player_id,
                    }),
                  )
                }
              />
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
}

/**
 * What the columns editor previews against — the most-owned player, named in its
 * footer so a share count can't pass as the column's own answer.
 *
 * The head of the *unfiltered* list rather than of what the field left: the
 * preview says what a metric looks like, and a reader who has typed three letters
 * should not find the editor previewing whoever that happened to match.
 */
function previewContext(
  shares: ReturnType<typeof playerShares>,
  adp: Map<string, AdpPlayerPayload>,
): ShareMetricContext | null {
  const first = shares.players[0];
  if (!first) return null;
  return {
    leagues: first.leagues,
    leagueCount: shares.league_count,
    adp: adp.get(first.player_id) ?? null,
  };
}

function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3 w-3 shrink-0 text-foreground/45"
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

function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3 w-3"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}
