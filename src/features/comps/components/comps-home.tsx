"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";

import type { CompCriterionId, CompWindowId } from "@/shared/contract";
import { DEFAULT_K, compsQueryParams } from "@/shared/comps";
import type { CompsRequest } from "@/shared/comps";

import {
  activeCount,
  activePairs,
  defaultCriteria,
  setWeight,
  toggleCriterion,
  toggleWindow,
  visibleCriteria,
} from "../helpers/criteria-state";
import { corpusNote } from "../helpers/format";
import { useCompPlayers } from "../hooks/use-comp-players";
import { useComps } from "../hooks/use-comps";
import { CompCard } from "./comp-card";
import { CriteriaPanel } from "./criteria-panel";
import { SubjectHousing } from "./subject-housing";

/**
 * The comps page: pick a player as he stands entering the coming season,
 * weight the criteria, and read the historical player-seasons nearest to him
 * beside what each of them did the year after.
 *
 * **All the page's state is here**, the handoff's own shape: the search, the
 * subject, whether the match list is open, the whole criteria table, the two
 * pool keys, the season range and `k`. Nothing is persisted — a comp is a
 * question asked once, not a device preference, and a stored set of weights
 * would greet the next visit with a distance nobody remembers choosing.
 *
 * **The distance runs on the server** and the question is the whole URL, so
 * every control below writes state and the request follows: `useComps` keys
 * on the serialised request, debounces it, and keeps the last answer on
 * screen while the next is in flight. The pool count on the strip is read
 * off that same answer, which is why it is asked for even before a subject
 * is picked — the strip has a figure to show either way.
 *
 * **The criteria preset to the subject's position, and stop doing so the
 * moment the reader edits them.** A running back opening on a receiver's
 * criteria is the thing `POSITION_PRESETS` exists to fix; a reader's own
 * weights being silently replaced when they pick a second player is a worse
 * failure than the one being fixed, so the preset only fires while the table
 * is untouched. `Reset` is what makes that reversible, and it is the whole of
 * why the key exists — without it a single nudged rail would strand a reader
 * on one position's criteria for the rest of the session.
 *
 * The three tweakables the prototype exposed are props with its defaults.
 */
export function CompsHome({
  heading,
  showPayoff = true,
  similarityMode = "percent",
  defaultK = DEFAULT_K,
}: {
  /** Static copy, rendered on the server — see the page. */
  heading: ReactNode;
  /** Draw the following-season pane on each card. */
  showPayoff?: boolean;
  /** Print the similarity as a percentage or as the raw distance. */
  similarityMode?: "percent" | "distance";
  /** How many comps a fresh page returns, 3–25. */
  defaultK?: number;
}) {
  const players = useCompPlayers();

  const [query, setQuery] = useState("");
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [criteria, setCriteria] = useState(() => defaultCriteria(null));
  // Whether the reader has edited the table. Once true the preset never fires
  // again on its own — see the note above.
  const [criteriaTouched, setCriteriaTouched] = useState(false);
  const [presetPosition, setPresetPosition] = useState<string | null>(null);
  const [posLock, setPosLock] = useState(true);
  const [excludeOwn, setExcludeOwn] = useState(true);
  // Null means the corpus's own edge, which the route reads off the data; the
  // selects show the resolved value once the players payload names it.
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [k, setK] = useState<number | null>(null);

  const subject = useMemo(
    () => players.payload?.players.find((p) => p.player_id === subjectId) ?? null,
    [players.payload, subjectId],
  );
  const position = subject?.position ?? null;

  // Preset during render rather than in an effect, the idiom
  // `useManagerLeagues` documents: an effect would paint one frame of the new
  // player's card under the previous position's criteria.
  if (!criteriaTouched && position !== presetPosition) {
    setPresetPosition(position);
    setCriteria(defaultCriteria(position));
  }

  const unavailable = players.payload?.source === "unavailable";
  const bounds = players.payload?.corpus ?? null;
  const seasons = useMemo(() => {
    if (!bounds || bounds.seasons === 0) return [];
    const list: number[] = [];
    for (let s = bounds.from; s <= bounds.to; s++) list.push(s);
    return list;
  }, [bounds]);
  const fromValue = from ?? bounds?.from ?? null;
  const toValue = to ?? bounds?.to ?? null;
  const kValue = k ?? defaultK;

  const pairs = useMemo(() => activePairs(criteria, position), [criteria, position]);
  const shown = useMemo(() => visibleCriteria(criteria, position), [criteria, position]);
  const request = useMemo<CompsRequest>(
    () => ({
      subject: subject?.player_id ?? null,
      from,
      to,
      k: kValue,
      posLock,
      excludeOwn,
      pairs,
    }),
    [subject, from, to, kValue, posLock, excludeOwn, pairs],
  );
  const requestKey = compsQueryParams(request).toString();
  const comps = useComps(request, requestKey, players.payload !== null && !unavailable);

  const active = activeCount(criteria, position);
  const board = comps.payload;
  // The board answers the question it was asked, and the subject is the one
  // part of it a stale answer must not be shown under — see `useComps` for
  // the render-time reset that guarantees it.
  const results = board?.comps ?? [];
  // Zero is what an empty corpus answers, and it is not a year. `??` keeps it,
  // which put "as he stands in 0" in the page's own opening sentence.
  const subjectSeason =
    players.payload && players.payload.subject_season > 0
      ? players.payload.subject_season
      : null;

  const reset = useCallback(() => {
    setCriteriaTouched(false);
    setPresetPosition(position);
    setCriteria(defaultCriteria(position));
  }, [position]);

  // Functional updates, so none of the three closes over `criteria` — which is
  // what lets them stay stable while a drag moves it sixty times a second.
  const onToggleCriterion = useCallback(
    (id: CompCriterionId) => {
      setCriteriaTouched(true);
      setCriteria((prev) => toggleCriterion(prev, id));
    },
    [],
  );
  const onToggleWindow = useCallback(
    (id: CompCriterionId, window: CompWindowId) => {
      setCriteriaTouched(true);
      setCriteria((prev) => toggleWindow(prev, id, window));
    },
    [],
  );
  const onSetWeight = useCallback(
    (id: CompCriterionId, window: CompWindowId, weight: number) => {
      setCriteriaTouched(true);
      setCriteria((prev) => setWeight(prev, id, window, weight));
    },
    [],
  );

  // The two clamp each other: raising `from` past `to` pushes `to` up, and
  // lowering `to` past `from` pulls `from` down.
  const onFrom = (season: number) => {
    setFrom(season);
    if (toValue !== null && season > toValue) setTo(season);
  };
  const onTo = (season: number) => {
    setTo(season);
    if (fromValue !== null && season < fromValue) setFrom(season);
  };

  const emptyNote = !subject
    ? "Pick a player above to run a comp."
    : active === 0
      ? "No criteria on — switch at least one on to run a comp."
      : board && board.subject === subject.player_id && results.length === 0
        ? board.pool.excluded_low_coverage > 0 && board.pool.eligible > 0
          ? `No season in the pool could be compared on enough of these criteria. ${board.pool.excluded_low_coverage} of ${board.pool.eligible} were dropped for thin stat coverage — switch a criterion off, or widen the season range.`
          : "No seasons in the pool. Widen the season range, or drop the position lock."
        : null;

  return (
    <>
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          {heading}
          <p className="mt-1 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
            {players.payload && bounds && !unavailable
              ? `${players.payload.subject_season} subject · ${bounds.from} – ${bounds.to} corpus · ${bounds.seasons} player-seasons`
              : players.error
                ? players.error
                : unavailable
                  ? "No corpus loaded"
                  : "Loading the corpus…"}
          </p>
        </div>
        <p className="ml-auto max-w-[26rem] font-display text-[length:var(--fs-13)] leading-normal text-foreground/[0.62] [text-wrap:pretty]">
          Pick a player as he stands in {subjectSeason ?? "the coming season"},
          weight the criteria, and the board returns the historical
          player-seasons nearest to him — with what each of them did the year
          after.
        </p>
      </header>

      {unavailable ? (
        <CorpusUnavailable />
      ) : (
        <>
          <SubjectHousing
            subject={subject}
            subjectSeason={subjectSeason}
            players={players.payload?.players ?? []}
            playersError={players.error}
            query={query}
            onQuery={(value) => {
              setQuery(value);
              setBrowsing(true);
            }}
            browsing={browsing}
            onPick={(id) => {
              setSubjectId(id);
              setBrowsing(false);
              setQuery("");
            }}
            onClear={() => {
              setSubjectId(null);
              setQuery("");
              setBrowsing(true);
            }}
            posLock={posLock}
            onPosLock={() => setPosLock((v) => !v)}
            excludeOwn={excludeOwn}
            onExcludeOwn={() => setExcludeOwn((v) => !v)}
            seasons={seasons}
            from={fromValue}
            to={toValue}
            onFrom={onFrom}
            onTo={onTo}
            k={kValue}
            onK={setK}
            pool={board?.pool ?? null}
          />

          <CriteriaPanel
            criteria={shown}
            activeCount={active}
            position={position}
            sampleCorpus={players.payload?.source === "sample"}
            onReset={reset}
            resettable={criteriaTouched}
            onToggle={onToggleCriterion}
            onWindow={onToggleWindow}
            onWeight={onSetWeight}
          />

          <div className="relative my-7 flex flex-wrap items-center gap-3">
            <span
              aria-hidden
              className="h-px flex-[1_1_3rem] bg-gradient-to-r from-active/35 via-foreground/5 to-transparent"
            />
            <p
              role="status"
              className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] tabular-nums text-foreground/70"
            >
              {subject
                ? `${results.length} comps · ${subject.name} · ${subjectSeason ?? ""}`
                : "No subject"}
            </p>
            {/* The board on screen answers the previous question while the next
                is in flight — see `useComps`, which keeps it there rather than
                blanking on every step of a rail drag. Something has to say so,
                or a reader reads the old numbers as the new ones. */}
            {comps.pending && (
              <p
                role="status"
                className="inline-flex items-center gap-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-readout [text-shadow:var(--readout-text-glow)]"
              >
                <span
                  aria-hidden
                  className="lab-anim h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-active shadow-[0_0_8px_var(--accent-glow)]"
                />
                Updating…
              </p>
            )}
            <p className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/60">
              {corpusNote(players.payload?.corpus_info ?? null)}
            </p>
          </div>

          {comps.error && (
            <p className="mb-4 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-error">
              {comps.error}
            </p>
          )}

          {results.length > 0 ? (
            <ul
              aria-busy={comps.pending}
              // Dimmed rather than replaced or emptied: the layout must not
              // shift under a control the reader is still dragging.
              className={`lab-anim flex flex-col gap-7 transition-opacity duration-200 ${
                comps.pending ? "opacity-60" : "opacity-100"
              }`}
            >
              {results.map((comp, index) => (
                <CompCard
                  key={`${comp.player_id}:${comp.season}`}
                  comp={comp}
                  place={index + 1}
                  of={results.length}
                  pairs={board?.pairs ?? []}
                  showPayoff={showPayoff}
                  similarityMode={similarityMode}
                />
              ))}
            </ul>
          ) : (
            emptyNote && (
              <p className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
                {emptyNote}
              </p>
            )
          )}
        </>
      )}
    </>
  );
}

/**
 * What the page draws when `player_seasons` has not been loaded and this
 * deployment will not answer from the sample.
 *
 * A state rather than an error, and the difference is what the reader can do
 * next: an error line says the page is broken, and this says what is missing
 * and who fills it. It names the command rather than describing it, because
 * the person who sees this in production is the person who can run it.
 */
function CorpusUnavailable() {
  return (
    <section className="mt-9 rounded-[0.875rem] border border-foreground/10 bg-foreground/[0.04] p-6 font-mono">
      <h2 className="text-[length:var(--fs-13)] uppercase tracking-[0.16em] text-readout [text-shadow:var(--readout-text-glow)]">
        No comps corpus loaded
      </h2>
      <p className="mt-2.5 max-w-[36rem] font-display text-[length:var(--fs-13)] leading-normal text-foreground/[0.72] [text-wrap:pretty]">
        Comps run against a table of historical player-seasons, and this
        deployment has none. Nothing is broken and nothing is missing from the
        page — there is simply no history to compare against yet.
      </p>
      <p className="mt-2.5 max-w-[36rem] font-display text-[length:var(--fs-13)] leading-normal text-foreground/[0.62] [text-wrap:pretty]">
        Load it with{" "}
        <code className="rounded bg-foreground/10 px-1.5 py-0.5 font-mono text-[length:var(--fs-11)]">
          npm run comps:load-corpus
        </code>
        .
      </p>
    </section>
  );
}
