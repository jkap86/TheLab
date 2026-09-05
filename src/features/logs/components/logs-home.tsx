"use client";

import { type ReactNode, useId, useMemo, useState } from "react";

import {
  CONSOLE_CARD,
  CONSOLE_KEY,
  CONSOLE_TRACK,
  CONSOLE_WELL,
} from "@/features/shared";

import {
  FACET_KEYS,
  type FacetKey,
  facetOptions,
  type LogFilters,
  hasFilters,
  matches,
  matchesQuery,
  NO_FILTERS,
  toLogRow,
  totals,
} from "../helpers/facets";
import {
  LOG_WINDOWS,
  type LogWindow,
  useVisitorLogs,
} from "../hooks/use-visitor-logs";
import { LogsTable, TotalWindow } from "./logs-table";

/**
 * `/logs` — who has reached this app, and when.
 *
 * The page is one instrument: a control deck over a list tray, in the console
 * vocabulary the rest of the app is built in. The feature it is ported from is
 * an arcade-styled table with five combobox filters; the information is the
 * same and the two behaviours that changed are documented where they live —
 * `facets.ts` for the menus, `client-ip.ts` for the addresses.
 *
 * **The whole window is fetched and narrowed in the browser**, deliberately.
 * Every facet menu is a cross-tab over the rows in hand, so answering them on
 * the server would be an aggregate per press; the read is capped rather than
 * paged for the same reason the shares drawers ship raw membership.
 */

const FACET_LABELS: Record<FacetKey, string> = {
  tool: "Tool",
  subject: "Subject",
  ip: "Address",
};

export function LogsHome({
  heading,
  token,
}: {
  /** The page's static copy, kept on the server side of the client boundary. */
  heading: ReactNode;
  /** Validated by the page before this renders; sent on every read. */
  token: string;
}) {
  const [hours, setHours] = useState<LogWindow>(24);
  const [filters, setFilters] = useState<LogFilters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  const { payload, loading, error, refresh } = useVisitorLogs(hours, token);
  const searchId = useId();

  const rows = useMemo(
    () => (payload?.entries ?? []).map(toLogRow),
    [payload],
  );

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => rows.filter((r) => matchesQuery(r, needle) && matches(r, filters)),
    [rows, needle, filters],
  );
  // The menus are built from the *unfiltered* rows narrowed by every facet but
  // their own — see `facetOptions`. Handing them `shown` is the bug that has no
  // symptom: each menu would collapse to its own selection.
  const options = useMemo(
    () => facetOptions(rows, filters, needle),
    [rows, filters, needle],
  );
  const counts = useMemo(() => totals(shown), [shown]);

  const narrowed = hasFilters(filters) || needle !== "";

  return (
    <div className="py-8">
      <div className="flex flex-wrap items-center gap-3">
        {heading}
        <div
          role="group"
          aria-label="Time window"
          className={`${CONSOLE_TRACK} ml-auto inline-flex gap-1 p-1`}
        >
          {LOG_WINDOWS.map((option) => (
            <button
              key={option.hours}
              type="button"
              onClick={() => setHours(option.hours)}
              aria-pressed={hours === option.hours}
              className={`rounded-full border px-3 py-1.5 font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] transition-[color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 ${
                hours === option.hours
                  ? "border-active/45 bg-[image:var(--key-bg)] text-readout shadow-[var(--key-shadow)] [text-shadow:var(--readout-text-glow)]"
                  : "border-transparent text-foreground/58 hover:text-readout"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={refresh} className={CONSOLE_KEY}>
          Refresh
        </button>
      </div>

      <div className={`${CONSOLE_WELL} mt-6 p-3`}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-52">
            <label
              htmlFor={searchId}
              className="mb-1 block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/60"
            >
              Search
            </label>
            <input
              id={searchId}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="route or address"
              // 16px or iOS Safari zooms the page on focus.
              className="w-full rounded-[0.5rem] border border-black/85 bg-[image:var(--readout-bg)] px-3 py-2 text-[16px] text-readout shadow-[var(--window-shadow)] placeholder:text-readout-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:text-[length:var(--fs-13)]"
            />
          </div>
          {FACET_KEYS.map((key) => (
            <Facet
              key={key}
              label={FACET_LABELS[key]}
              value={filters[key]}
              options={options[key]}
              onChange={(value) =>
                setFilters((prev) => ({ ...prev, [key]: value }))
              }
            />
          ))}
          {narrowed ? (
            <button
              type="button"
              onClick={() => {
                setFilters(NO_FILTERS);
                setQuery("");
              }}
              className={CONSOLE_KEY}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {/* Three readouts, not the four this shipped with: `Viewers` counted the
          stored accounts behind the visits, which was the last account each
          browser had looked up rather than the person looking. The grid is an
          odd number now, so it stays one row at every width rather than
          leaving a widow on the second. */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <TotalWindow label="Visits" value={counts.visits} />
        <TotalWindow label="Addresses" value={counts.ips} />
        <TotalWindow label="Subjects" value={counts.subjects} />
      </div>

      {/* One live region for the whole page, so a window change, a failure and
          an empty result are announced through one channel rather than three. */}
      <p
        role="status"
        className="mt-3 min-h-5 font-mono text-[length:var(--fs-11)] text-foreground/60"
      >
        {error
          ? error
          : loading
            ? "Reading visits…"
            : payload?.truncated
              ? `Showing the most recent ${rows.length.toLocaleString()} visits — the window holds more.`
              : narrowed
                ? `${shown.length.toLocaleString()} of ${rows.length.toLocaleString()} visits`
                : ""}
      </p>

      <div className={`${CONSOLE_CARD} mt-4`}>
        {loading || error ? null : shown.length === 0 ? (
          // Two empty states, because they are two claims: one is about the
          // window, the other about the selection.
          <p className="px-2 py-8 text-center text-[length:var(--fs-14)] text-foreground/60">
            {rows.length === 0
              ? "No visits recorded in this window."
              : "No visits match these filters."}
          </p>
        ) : (
          <LogsTable rows={shown} />
        )}
      </div>
    </div>
  );
}

/**
 * One facet menu.
 *
 * A native `<select>`, which is what the app's other one-of-many controls are
 * (`league-teams`' metric picker): it brings the keyboard behaviour, the label
 * association and a platform-native list on a phone, none of which a custom
 * combobox gets for free — and the picktracker's own combobox exists only
 * because it needs a typeahead over 113 leagues, which the Search field beside
 * this covers here.
 */
function Facet({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 basis-36">
      <label
        htmlFor={id}
        className="mb-1 block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-foreground/60"
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-[0.5rem] border border-foreground/12 bg-[image:var(--key-bg)] px-2 py-2 text-[16px] text-foreground/85 shadow-[var(--key-shadow)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-active/60 sm:text-[length:var(--fs-13)]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
