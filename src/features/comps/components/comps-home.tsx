"use client";

import { useEffect, useMemo, useState } from "react";

import { ErrorCard } from "@/features/shared/ui/panel-message";
import { FlaskLoader, PageHeading } from "@/features/shared";

import {
  boardSettleDelay,
  boardSettlePending,
  effectiveBoardKey,
} from "../board-settle";
import { buildCompsQuery } from "../build-query";
import { useComps } from "../hooks/use-comps";
import { useCompsPlayers } from "../hooks/use-comps-players";
import {
  isCustomized,
  resetPosition,
  setPositionWeights,
  setPositionWindows,
  weightsFor,
  windowsFor,
} from "../prefs";
import { draftSummary } from "../season-line";
import { useCompsPrefs } from "../use-comps-prefs";
import { FieldEditor } from "./field-editor";
import { PlayerPicker } from "./player-picker";
import { ResultsList } from "./results-list";

import { compsDimensionLabel } from "../../../shared/comps/windows";

import type { CompsBoardTarget } from "../board-settle";
import type { CompsBasis } from "../../../shared/comps/filters";
import type { CompsWindowKey } from "../../../shared/comps/windows";
import type { CompsPlayerOptionPayload } from "../types";

/**
 * The comps tool, comps-first: pick a player and the defaults answer at once —
 * the field editor is a disclosure for the reader who wants to retune, not a
 * form standing between them and the first result.
 *
 * Weight edits are debounced (~250ms) before they reach the query key, and
 * while the rows on screen belong to an older selection they dim under an
 * "Updating…" note — held rows must never read as answering the new weights.
 * **A change of subject position is not one of those edits** and skips the
 * debounce entirely (`board-settle.ts`), since a board belongs to a position.
 */
export function CompsHome() {
  const players = useCompsPlayers();
  const { prefs, update } = useCompsPrefs();

  const [subject, setSubject] = useState<CompsPlayerOptionPayload | null>(null);
  // Null means the subject's latest stored season — the server's own default.
  const [season, setSeason] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const position = subject?.position ?? null;
  const weights = useMemo(
    () => (position ? weightsFor(prefs, position) : null),
    [prefs, position],
  );
  const windows = useMemo(
    () => (position ? windowsFor(prefs, position) : null),
    [prefs, position],
  );

  // Only a *customized* board travels; the untouched one goes as no fields= at
  // all, sharing the default board's cache entry. Debounced as a string so a
  // drag across a slider is one request, not one per notch — and the windows
  // ride in the same string, since a window change is exactly as expensive a
  // re-fetch as a weight change and settling them apart would fire two.
  //
  // **The debounce is per position, and a position change skips it** — see
  // `board-settle.ts`: held across one, it would build a request pairing the
  // new subject with the previous position's board.
  const customized = position !== null && isCustomized(prefs, position);
  const boardKey =
    customized && weights && windows
      ? JSON.stringify({ weights, windows })
      : "";
  const board = useMemo(() => ({ position, boardKey }), [position, boardKey]);
  const settledBoard = useSettledBoard(board);
  const settledBoardKey = effectiveBoardKey(settledBoard, board);
  const weightsPending = boardSettlePending(settledBoard, board);

  const query = useMemo(() => {
    if (!subject) return null;
    const settled = settledBoardKey
      ? (JSON.parse(settledBoardKey) as {
          weights: Record<string, number>;
          windows: Record<string, CompsWindowKey>;
        })
      : null;
    return buildCompsQuery({
      playerId: subject.player_id,
      season,
      basis: prefs.basis,
      position: subject.position,
      weights: settled?.weights ?? null,
      windows: settled?.windows,
    });
  }, [subject, season, prefs.basis, settledBoardKey]);

  // The subject is passed so a held payload can never be a *different*
  // player's: `keepPreviousData` holds the board through a re-key, which is what
  // makes a weight or window edit flicker-free and what would otherwise put the
  // previous player's comps under the new player's name. See `comps-state.ts`.
  const comps = useComps(query, subject?.player_id ?? null);
  const updating = comps.stale || weightsPending || (comps.loading && !!comps.data);
  // No subject guard needed: what `comps.data` holds already describes the
  // player on screen, so the draft line cannot be filed under the wrong name.
  const subjectDraft = comps.data ? draftSummary(comps.data.subject) : null;

  const pickSubject = (player: CompsPlayerOptionPayload) => {
    setSubject(player);
    setSeason(null);
  };

  const setBasis = (basis: CompsBasis) => update({ ...prefs, basis });

  return (
    <div>
      <PageHeading
        title="Comps"
        lede="Pick a player and get the most similar player-seasons on record — weighted however you like."
        className="mb-6"
      />

      <PlayerPicker
        players={players.data?.players ?? []}
        loading={players.data === null && players.loading}
        onSelect={pickSubject}
      />
      {players.error && (
        <div className="mt-4">
          <ErrorCard message={players.error} />
        </div>
      )}

      {subject && (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-sm text-foreground">
              {subject.name}
            </span>
            <span className="text-xs text-foreground/40">
              {subject.position}
              {/* Read off the answer rather than the picker: `/api/comps/players`
                  is a name list and knows nothing about the draft, where the
                  comps payload's own subject row carries it. So it appears once
                  a comparison has run, which is also the only time it means
                  anything beside the comps that wear the same label. */}
              {subjectDraft && (
                <span title={subjectDraft.full}> · {subjectDraft.short}</span>
              )}
              {subject.team && <> · Current: {subject.team}</>}
            </span>

            {subject.seasons.length > 1 && (
              <span className="ml-2 flex items-center gap-1">
                {subject.seasons.map((s, i) => {
                  const lit = season === s || (season === null && i === 0);
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSeason(i === 0 ? null : s)}
                      className={`lab-chip lab-chip-sm rounded-full px-2.5 py-0.5 text-xs ${
                        lit ? "lab-chip-on" : "text-foreground/60"
                      }`}
                    >
                      {s}
                    </button>
                  );
                })}
              </span>
            )}

            <span className="ml-auto flex items-center gap-1">
              {(["per_game", "total"] as const).map((basis) => (
                <button
                  key={basis}
                  type="button"
                  onClick={() => setBasis(basis)}
                  className={`lab-chip lab-chip-sm rounded-full px-2.5 py-0.5 text-xs ${
                    prefs.basis === basis ? "lab-chip-on" : "text-foreground/60"
                  }`}
                >
                  {basis === "per_game" ? "Per game" : "Totals"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setEditorOpen((o) => !o)}
                aria-expanded={editorOpen}
                className={`lab-chip lab-chip-sm rounded-full px-2.5 py-0.5 text-xs ${
                  editorOpen || customized ? "lab-chip-on" : "text-foreground/60"
                }`}
              >
                Customize comparison
              </button>
            </span>
          </div>

          {comps.data && !editorOpen && (
            <p className="text-xs text-foreground/45">
              {/* The dimension label, not the field's: a board comparing on
                  three years of targets and one that compares on last season's
                  are different boards, and the summary is the only place that
                  says which one is on screen while the editor is shut. */}
              Comparing on{" "}
              {fieldSummary(
                comps.data.fields.map((f) => compsDimensionLabel(f.key)),
              )}
              {" · "}
              {comps.data.basis === "per_game" ? "per game" : "season totals"}
            </p>
          )}

          {editorOpen && position && weights && windows && (
            <FieldEditor
              position={position}
              weights={weights}
              windows={windows}
              customized={customized}
              onWeight={(key, weight) =>
                update(
                  setPositionWeights(prefs, position, {
                    ...weights,
                    [key]: weight,
                  }),
                )
              }
              onWindow={(key, window) =>
                update(
                  setPositionWindows(prefs, position, {
                    ...windows,
                    [key]: window,
                  }),
                )
              }
              onReset={() => update(resetPosition(prefs, position))}
            />
          )}

          {comps.error && !comps.data && <ErrorCard message={comps.error} />}
          {!comps.data && !comps.error && comps.loading && (
            <div className="flex justify-center py-10">
              <FlaskLoader label="Finding comps" />
            </div>
          )}
          {comps.data && <ResultsList payload={comps.data} stale={updating} />}
        </div>
      )}
    </div>
  );
}

/** "targets, receiving yards, receptions + 3 more". */
function fieldSummary(labels: string[]): string {
  const head = labels.slice(0, 3).map((label) => label.toLowerCase());
  const rest = labels.length - head.length;
  return rest > 0 ? `${head.join(", ")} + ${rest} more` : head.join(", ");
}

/**
 * The board the last settled edit belongs to — what `effectiveBoardKey` reads
 * against, trailing the controls by `COMPS_BOARD_SETTLE_MS` for an edit within
 * one position and by a tick for a change of position.
 *
 * The decision is `board-settle.ts`'s; what is left here is the timer.
 * **Nothing a request is built from waits on this**, which is why a tick is
 * fine for the position change: the effective key is *derived* during render,
 * so it is the new position's board from the first render after the press, and
 * this state catching up afterwards only moves the baseline the next edit is
 * debounced against. A value derived during render cannot be a frame behind the
 * state it is derived from, where a piece of state an effect catches up always
 * can — which is the beat the wrong pairing used to happen in.
 */
function useSettledBoard(target: CompsBoardTarget): CompsBoardTarget {
  const [settled, setSettled] = useState(target);
  useEffect(() => {
    const delay = boardSettleDelay(settled, target);
    if (delay === null) return;
    const timer = setTimeout(() => setSettled(target), delay);
    return () => clearTimeout(timer);
  }, [settled, target]);
  return settled;
}
