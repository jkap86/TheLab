"use client";

import { Scanlines } from "@/features/shared";

import type { LogRow } from "../helpers/facets";

/**
 * The visit list.
 *
 * **A real `<table>`**, where the rest of the app builds its lists out of divs.
 * This is the one screen whose content genuinely is a grid of like-typed cells
 * with headers that name them, and the element carries the row/column
 * relationship to a screen reader for free.
 *
 * **The rows are flat** — no perspective, no `translateZ`, nothing behind a
 * `pointer-fine:` gate. It is the shares drawer's budget argument: the league
 * grid spends ~6 composited planes a card and gates all of it because iOS
 * Safari's per-tab GPU budget dies on 113 of them, and this list runs to
 * thousands of rows.
 *
 * **A missing value is an em dash, never a blank and never a zero** — the app's
 * three-way grammar. A visit with no address is not a visit from 0.0.0.0, and a
 * route with no subject is not a page about nobody: it is a page that is about
 * no one in particular, which is most of them.
 *
 * **There was a Viewer column and it is gone**, with the cookie and the column
 * behind it: it named the last account the browser had looked up, which on an
 * app built for looking other people up is usually not the reader. Every column
 * left is either stamped by the request or read out of the path — nothing here
 * claims to know who anybody is.
 *
 * **The Subject column is dropped below `sm`, and the table takes no minimum
 * width.** Five columns in a 390px viewport is 78px each, and the alternative —
 * a minimum width with the table scrolling inside its own container — does not
 * hold here: measured at 390, `documentElement.scrollWidth` went to 492 with the
 * whole page scrolling sideways, which is the one thing this app's layouts are
 * not allowed to do. Subject is the column to lose because it is the only one
 * that is *derived*: the route printed under the tool already contains it, so
 * dropping it removes a reading rather than a fact. That is the console card's
 * own rule for its plates, which drop the points rank and the year at the same
 * breakpoint and for the same reason.
 *
 * **Losing the Viewer column did not buy Subject a place back at 390, which was
 * measured rather than assumed.** Shown, the four columns are 79px each — the
 * width the five-column layout gave its four visible ones, so the phone table
 * would be exactly as cramped as the arrangement this rule already rejected.
 * Dropped, the three left are 105px, and the page takes no horizontal scroll
 * either way. So the breakpoint stays where it was and the width goes to the
 * columns that survived.
 */

const CELL = "px-3 py-2 align-top";
const HEAD =
  "px-3 py-2 text-left font-mono text-[length:var(--fs-10)] uppercase tracking-[0.16em] text-readout-label";

export function LogsTable({ rows }: { rows: readonly LogRow[] }) {
  return (
    <div className="lab-scroll max-h-[65svh] overflow-y-auto overscroll-contain rounded-[0.75rem]">
      <table className="w-full table-fixed border-collapse text-[length:var(--fs-13)]">
        <caption className="sr-only">
          Visits, newest first. Columns: time, tool and route, subject (wide
          viewports only), and address.
        </caption>
        <thead className="sticky top-0 z-10 bg-[image:var(--housing-bg)]">
          <tr className="border-b border-foreground/12">
            <th scope="col" className={HEAD}>
              When
            </th>
            <th scope="col" className={HEAD}>
              Tool
            </th>
            <th scope="col" className={`${HEAD} hidden sm:table-cell`}>
              Subject
            </th>
            <th scope="col" className={HEAD}>
              Address
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Row key={row.id} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Row({ row }: { row: LogRow }) {
  // No locale argument, deliberately: the ported original hardcodes "en-US" for
  // a page only its author reads. The rows are rendered after a fetch, so there
  // is no server render for a locale difference to mismatch against. The clock
  // is pinned to 24 hours all the same — a meridiem is a fifth token in a column
  // that gets a third of 390px, and it wrapped onto a line of its own.
  const when = new Date(row.seen_at);
  const time = when.toLocaleTimeString(undefined, { hourCycle: "h23" });
  return (
    <tr className="border-b border-foreground/8 last:border-b-0">
      <td className={`${CELL} font-mono text-[length:var(--fs-11)] text-readout-muted`}>
        {when.toLocaleDateString()}
        <br />
        <span className="text-readout-line">{time}</span>
      </td>
      <td className={`${CELL} break-words`}>
        <span className="text-readout-line">{row.tool || <Dash />}</span>
        {/* The full path, because the columns beside it are a reading of it and
            a reading can only show what it knows how to name. */}
        <span className="mt-0.5 block break-all font-mono text-[length:var(--fs-10)] text-readout-muted">
          {row.route}
        </span>
      </td>
      <td className={`${CELL} hidden break-all text-readout-line sm:table-cell`}>
        {row.subject ?? <Dash />}
      </td>
      <td className={`${CELL} break-all font-mono text-[length:var(--fs-11)] text-readout-muted`}>
        {row.ip ?? <Dash />}
      </td>
    </tr>
  );
}

/** An absent value. `aria-hidden` with a word behind it, so it is not read as "dash". */
function Dash() {
  return (
    <>
      <span aria-hidden className="text-readout-muted">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}

/** A lit readout for one of the totals above the table. */
export function TotalWindow({
  label,
  value,
  className = "",
}: {
  label: string;
  value: number;
  className?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden rounded-[0.625rem] border border-black/85 bg-[image:var(--readout-bg)] px-3 py-2 shadow-[var(--window-shadow)] ${className}`}
    >
      <Scanlines />
      <span className="relative block font-mono text-[length:var(--fs-9)] uppercase tracking-[0.16em] text-readout-label">
        {label}
      </span>
      <span className="relative mt-0.5 block font-mono text-[length:var(--fs-17)] tabular-nums text-readout [text-shadow:var(--readout-text-glow)]">
        {value.toLocaleString()}
      </span>
    </div>
  );
}
