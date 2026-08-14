"use client";

import { useEffect, useMemo, useState } from "react";

import { ErrorCard } from "@/features/shared/ui/panel-message";
import { FlaskLoader, PageHeading } from "@/features/shared";

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
import { useCompsPrefs } from "../use-comps-prefs";
import { FieldEditor } from "./field-editor";
import { PlayerPicker } from "./player-picker";
import { ResultsList } from "./results-list";

import { compsDimensionLabel } from "../../../shared/comps/windows";

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
  const customized = position !== null && isCustomized(prefs, position);
  const boardKey =
    customized && weights && windows
      ? JSON.stringify({ weights, windows })
      : "";
  const settledBoardKey = useDebouncedValue(boardKey, 250);
  const weightsPending = settledBoardKey !== boardKey;

  const query = useMemo(() => {
    if (!subject) return null;
    const board = settledBoardKey
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
      weights: board?.weights ?? null,
      windows: board?.windows,
    });
  }, [subject, season, prefs.basis, settledBoardKey]);

  const comps = useComps(query);
  const updating = comps.stale || weightsPending || (comps.loading && !!comps.data);

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

/** The value as of `ms` ago — a trailing debounce over any value. */
function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return;
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, debounced]);
  return debounced;
}
