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
 * press that fetched nothing has to speak. The *mark* reports the same thing
 * without words — see {@link SyncIcon}, which turns and takes the accent while
 * the request is out.
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
          className={`min-w-0 truncate text-[0.625rem] font-semibold uppercase tracking-[0.08em] ${
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
        className="lab-chip lab-chip-sm flex shrink-0 items-center gap-1.5 rounded-full px-2 py-[3px] text-[0.625rem] font-semibold text-foreground/75 transition-colors hover:text-foreground disabled:opacity-60"
      >
        <SyncIcon spinning={pending} />
        {pending ? "Syncing" : "Sync"}
      </button>
    </div>
  );
}

/**
 * The mark: two opposed arcs turning about a hub that doesn't.
 *
 * **The hub is the point of it, and it is a sibling of the rotor rather than
 * inside it.** A whole icon spinning is a spinner — every app has one, and it
 * says "waiting" rather than anything about this app. Arcs turning *around* a
 * fixed axle is a machined part, which is the grammar everything else on this
 * panel is built in: the trough under the tab strip, the wells, the app bar's
 * raised keys. It costs one element and a transform origin (see `.sync-rotor` in
 * `globals.css`, which pivots on the viewBox's centre rather than the rotor's own
 * box, so the axle is the pivot by construction).
 *
 * **Two arcs with solid heads rather than one arc with a chevron.** The single
 * arc it replaced was the smallest thing that reads as "refresh", which is a
 * different bar from being worth looking at. Drawn and measured in a browser at
 * 14px: stroked chevron heads merge into the arc and read as lumps at this size,
 * where filled triangles keep their point — so the heads are triangles, and the
 * arcs stop at ~130° each to leave a gap the heads can be read against.
 *
 * **14px rather than 12.** The extra two pixels are what the hub and the second
 * head need to be legible; below that the mark silts up and the decoration is
 * mud, which is the trade this codebase keeps making explicit about small parts.
 *
 * **The accent is spent here and nowhere else on the key.** While the request is
 * out the mark takes `active` and a soft glow — the same lit-lamp spelling the
 * nameplate's status dot uses — and the label and the key's face stay exactly as
 * they are. That is the app bar's rule about a narrowed board lighting the *bars*
 * rather than the face, read at this scale: the signal rides on the part that
 * already means "sync", so the key never looks like it is in an on state it has
 * no off state for.
 */
function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`size-3.5 shrink-0 transition-colors ${
        spinning
          ? "text-active drop-shadow-[0_0_3px_rgba(0,255,229,0.55)]"
          : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <g className={`sync-rotor ${spinning ? "sync-rotor-on" : ""}`}>
        {/* 200°→325° and its 180° twin, so the pair is symmetric about the hub
            and the rotor's turn looks the same at every angle. Each head is a
            filled triangle seated on the arc's end, pointing along the travel. */}
        <path d="M3.07 6.20A5.25 5.25 0 0 1 12.30 4.99" />
        <path d="M13.86 3.90L14.02 7.45L10.74 6.08Z" fill="currentColor" stroke="none" />
        <path d="M12.93 9.80A5.25 5.25 0 0 1 3.70 11.01" />
        <path d="M2.14 12.10L1.98 8.55L5.26 9.92Z" fill="currentColor" stroke="none" />
      </g>
      {/* The axle. Outside the rotor, which is what makes the turn read. */}
      <circle cx="8" cy="8" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}
