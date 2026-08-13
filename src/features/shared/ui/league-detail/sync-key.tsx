"use client";

import { useLeagueRefresh } from "../../use-league-refresh";
import { lastUpdatedNote, syncStatusNote } from "./sync-status";

/**
 * The key that re-reads this league from Sleeper, on the trailing end of the
 * panel's head band.
 *
 * **It exists because this panel is where a lineup is read and Sleeper is where
 * one is set.** A reader opens a league here, sees points left on the bench,
 * goes and makes the swap in Sleeper's own app, and comes back — and until they
 * press this, what they come back to is whatever the crawler last stored, which
 * in season is up to fifteen minutes old. Nothing about the crawl can be tuned
 * to serve that (see `refreshLeague`), so the answer is a press.
 *
 * **It is drawn on a week panel and nowhere else**, which the panel derives
 * rather than being told — see {@link LeagueDetailPanel}'s `syncable`.
 *
 * **A raised pill, the app's own grammar**, and the same
 * `lab-chip lab-chip-sm rounded-full` spelling the subject rail's two doors and
 * the ADP drawer's smallest keys wear — raised is what a control you press looks
 * like here, and borrowing the spelling is what keeps one more of them from
 * being one more shape. It is never `.lab-chip-on`: the lit state belongs to a
 * control that is *narrowing* something, and this narrows nothing.
 *
 * What it says back is {@link syncStatusNote}'s, which is where the rule lives
 * and is tested: a press that changed something is answered by the rows, and a
 * press that fetched nothing has to speak.
 */
export function LeagueSyncKey({ leagueId }: { leagueId: string }) {
  const { refresh, pending, result, error } = useLeagueRefresh(leagueId);
  const note = syncStatusNote(pending, result, error);

  return (
    <div className="ml-auto flex min-w-0 items-center gap-2">
      {/* Polite, not assertive: a refresh is something the reader asked for and
          is watching, so it is read out when they are idle rather than
          interrupting whatever they are on. The note beside it is `aria-hidden`
          because it is this sentence abbreviated to a cell's width — announcing
          both would be the same answer twice. */}
      <span className="sr-only" role="status">
        {pending ? "Refreshing league" : (note?.speech ?? "")}
      </span>

      {note && (
        <span
          aria-hidden="true"
          className={`min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.08em] ${
            note.tone === "attention" ? "text-amber-300/80" : "text-foreground/45"
          }`}
        >
          {note.text}
        </span>
      )}

      <button
        type="button"
        onClick={refresh}
        // Disabled only while a press is in flight, never by a cooldown the
        // client counts down for itself: a key that greys out for fifteen
        // seconds after every press is a key a reader learns not to trust, and
        // the server's own answer is both cheap and the only one that knows
        // whether the crawler got there first.
        disabled={pending}
        title={
          pending
            ? "Re-reading this league from Sleeper"
            : `Re-read this league from Sleeper${lastUpdatedNote(result)}`
        }
        className="lab-chip lab-chip-sm flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[10px] font-semibold text-foreground/75 transition-colors hover:text-foreground disabled:opacity-60"
      >
        <SyncIcon spinning={pending} />
        {pending ? "Syncing" : "Sync"}
      </button>
    </div>
  );
}

/**
 * A circular arrow, turning while the request is out.
 *
 * The spin is `motion-safe:` rather than a class cancelled under
 * `prefers-reduced-motion`, so a reader who asked for less motion gets a static
 * mark and the *word* beside it — the same call the flask loader makes, where
 * what has to survive the reduction is the status rather than the animation.
 */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-3 shrink-0 ${spinning ? "motion-safe:animate-spin" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* An arc rather than a closed ring, so the arrowhead has somewhere to be:
          a full circle with a head on it reads as a clock at 12px. */}
      <path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.97" />
      <path d="M13.5 2.2V4.6h-2.4" />
    </svg>
  );
}
