"use client";

import { useState } from "react";

import { PositionBadge } from "@/features/shared";

import type { CompsPayload, CompsResultRowPayload } from "../types";

/**
 * The comps themselves. Three presentation rules are decisions, not styling:
 *
 * - **"Similarity 82" is a score, never "82% match"** — the map is
 *   `100·exp(−d)`, fixed across every result set so 82 always means the same
 *   gap, and a percent would claim a scale nobody defined.
 * - **Every row's team reads as "Current: X"**, uniformly — `players` stores
 *   no historical team, so the honest treatment is the same secondary styling
 *   on every row rather than guessing which rows are historical.
 * - **The counts are on screen** — a two-season pool is thin in year one, and
 *   "141 eligible of 162 considered" is what keeps the answer honest about
 *   what it was drawn from.
 */
export function ResultsList({
  payload,
  stale,
}: {
  payload: CompsPayload;
  stale: boolean;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);

  const missing =
    payload.candidates_considered - payload.candidates_eligible;

  return (
    <section className={stale ? "opacity-50 transition-opacity" : "transition-opacity"}>
      <p className="mb-2 text-xs text-foreground/45" aria-live="polite">
        {payload.candidates_eligible.toLocaleString()} eligible comps ·{" "}
        {payload.candidates_considered.toLocaleString()} considered
        {missing > 0 && <> · {missing.toLocaleString()} missing a weighted field</>}
        {payload.dropped_fields.length > 0 && (
          <>
            {" "}
            · not compared on {payload.dropped_fields.join(", ")} (no value for
            the subject)
          </>
        )}
        {stale && <span className="ml-2 text-active/80">Updating…</span>}
      </p>

      {payload.results.length === 0 ? (
        <p className="rounded-lg border border-foreground/10 px-4 py-6 text-sm text-foreground/50">
          No eligible comps under these settings — widen the positions, lower
          the minimum games, or unweight a market field.
        </p>
      ) : (
        <ol className="space-y-2">
          {payload.results.map((row) => {
            const key = `${row.player_id}:${row.season}`;
            return (
              <ResultRow
                key={key}
                row={row}
                payload={payload}
                open={openRow === key}
                onToggle={() => setOpenRow(openRow === key ? null : key)}
              />
            );
          })}
        </ol>
      )}
    </section>
  );
}

function ResultRow({
  row,
  payload,
  open,
  onToggle,
}: {
  row: CompsResultRowPayload;
  payload: CompsPayload;
  open: boolean;
  onToggle: () => void;
}) {
  const samePlayer = row.player_id === payload.subject.player_id;
  return (
    <li className="rounded-xl border border-foreground/10 bg-foreground/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="lab-readout shrink-0 rounded px-2 py-1 font-display text-sm tabular-nums text-foreground">
          {row.similarity}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <PositionBadge position={row.position} />
            <span className="truncate font-display text-sm text-foreground">
              {row.name}
            </span>
            <span className="shrink-0 text-xs text-foreground/50">
              {row.season}
            </span>
            {samePlayer && (
              <span className="shrink-0 rounded-full bg-active/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-active/80">
                same player
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-foreground/40">
            {row.games} games
            {row.team && <> · Current: {row.team}</>}
          </span>
        </span>
        <span
          aria-hidden
          className={`shrink-0 text-foreground/30 transition-transform ${open ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {open && (
        <div className="border-t border-foreground/10 px-4 py-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-foreground/35">
                <th className="py-1 pr-2 font-medium">Field</th>
                <th className="py-1 pr-2 text-right font-medium">
                  {payload.subject.name}
                </th>
                <th className="py-1 pr-2 text-right font-medium">{row.name}</th>
                <th className="py-1 text-right font-medium">Pool avg</th>
              </tr>
            </thead>
            <tbody>
              {payload.fields.map((field) => (
                <tr key={field.key} className="border-t border-foreground/5">
                  <td className="py-1 pr-2 text-foreground/60">
                    {field.label}
                    {field.per_game && payload.basis === "per_game" && (
                      <span className="text-foreground/30"> /g</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-foreground/80">
                    {cell(payload.subject.values[field.key])}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums text-foreground/80">
                    {cell(row.values[field.key])}
                  </td>
                  <td className="py-1 text-right tabular-nums text-foreground/45">
                    {cell(field.pool_mean)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-foreground/35">
            Distance {row.distance} · similarity is 100·e
            <sup>−distance</sup>, a fixed score rather than a percentage.
          </p>
        </div>
      )}
    </li>
  );
}

/** A value cell: an em dash for an unknown, never 0. */
function cell(value: number | null | undefined): string {
  return value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
