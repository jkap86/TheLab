"use client";

import { type ReactNode, useMemo, useState } from "react";

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
} from "../helpers/criteria-state";
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
  const [criteria, setCriteria] = useState(defaultCriteria);
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

  const pairs = useMemo(() => activePairs(criteria), [criteria]);
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
  const comps = useComps(request, requestKey, players.payload !== null);

  const active = activeCount(criteria);
  const board = comps.payload;
  // The board answers the question it was asked, and the subject is the one
  // part of it a stale answer must not be shown under — see `useComps` for
  // the render-time reset that guarantees it.
  const results = board?.comps ?? [];
  const subjectSeason = players.payload?.subject_season ?? null;

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
        ? "No seasons in the pool. Widen the season range, or drop the position lock."
        : null;

  return (
    <>
      <header className="flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          {heading}
          <p className="mt-1 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
            {players.payload && bounds
              ? `${players.payload.subject_season} subject · ${bounds.from} – ${bounds.to} corpus · ${bounds.seasons} player-seasons`
              : players.error
                ? players.error
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
        criteria={criteria}
        activeCount={active}
        sampleCorpus={players.payload?.source !== "stored"}
        onToggle={(id: CompCriterionId) => setCriteria((c) => toggleCriterion(c, id))}
        onWindow={(id: CompCriterionId, window: CompWindowId) =>
          setCriteria((c) => toggleWindow(c, id, window))
        }
        onWeight={(id, window, weight) => setCriteria((c) => setWeight(c, id, window, weight))}
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
        <p className="font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-foreground/60">
          {players.payload?.source === "stored" ? "Stored corpus" : "Sample corpus"}
        </p>
      </div>

      {comps.error && (
        <p className="mb-4 font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-error">
          {comps.error}
        </p>
      )}

      {results.length > 0 ? (
        <ul className="flex flex-col gap-7">
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
  );
}
