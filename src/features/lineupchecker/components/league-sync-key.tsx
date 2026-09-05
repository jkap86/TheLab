"use client";

import { CONSOLE_KEY } from "@/features/shared";

import { syncStatusNote } from "../helpers/sync-status-note";
import { useLeagueRefresh } from "../hooks/use-league-refresh";

/**
 * The key that re-reads one league from Sleeper, and the note beside it.
 *
 * **A component of its own so `LineupCheckCard` stays hook-free**, which is that
 * card's stated design and `LeagueCard`'s before it: the card renders a league,
 * and the state a card needs lives below it. The card takes `onSynced` and
 * forwards it here without ever calling it.
 *
 * **It lives in the disclosure body, not in the `<summary>`**, and that is an
 * accessibility decision rather than a layout one. A `<summary>` maps to a leaf
 * `button` in the accessibility tree: a nested `<button>` is unreliably
 * reachable across assistive technology, and a live region inside one is folded
 * into the disclosure's accessible name instead of being announced. Two
 * consequences fall out in this codebase's favour — the body is already
 * documented as outside the card's 3D context, so this needs no `translateZ`, no
 * direct-child-of-`<summary>` discipline and no `pointer-fine:` gate; and it
 * sits exactly where "No lineup read for this league this week" renders, which
 * is the case a sync most often fixes and which is otherwise a dead end.
 *
 * **The key is disabled while a press is in flight and at no other time.** In
 * particular there is no client-side cooldown countdown, for three reasons: the
 * server's `retry_after_ms` is measured against its own clock and a background
 * tab throttles timers to about once a minute, so a countdown would re-enable a
 * key the server still refuses; it would be one interval *per card* on a page
 * with no virtualization, which is the per-device budget argument the card's own
 * `pointer-fine:` gate is built from; and pressing during a cooldown is a cheap
 * 200 that answers with a fresh number, where a key greyed out on a stale one
 * cannot correct itself.
 *
 * `aria-disabled` rather than the `disabled` attribute, with the hook's own ref
 * as the real guard: browsers **blur an element that becomes disabled while
 * focused**, and this key toggles for one round trip inside a list of up to a
 * hundred cards — a keyboard reader would be dumped to `<body>` and have to tab
 * back. `WeekStepper` keeps real `disabled` because its states are stable facts
 * about the week bounds rather than a momentary one about a request.
 */
export function LeagueSyncKey({
  leagueId,
  leagueName,
  onSynced,
}: {
  leagueId: string;
  /** Named in the accessible label, so a hundred keys are not a hundred "Sync"s. */
  leagueName: string;
  /** Re-read this league once the press has actually changed something. */
  onSynced?: (leagueId: string) => void;
}) {
  const { refresh, pending, result, error } = useLeagueRefresh(leagueId);
  const note = syncStatusNote(pending, result, error);

  const press = async () => {
    const answer = await refresh();
    // Gated on `synced` rather than on the status, and on the same field the
    // note reads: `cooldown`, `locked` and `failed` all left Postgres exactly as
    // it was, so re-reading after them is a round trip for the bytes already on
    // screen.
    if (answer?.synced) onSynced?.(leagueId);
  };

  return (
    <div className="mb-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={() => void press()}
        aria-disabled={pending}
        // "Sync" leads, so the visible label is a prefix of the accessible one
        // and a reader speaking the words on screen still hits this control.
        aria-label={`Sync ${leagueName} from Sleeper`}
        title="Re-read this league's rosters and this week's lineup from Sleeper"
        className={`${CONSOLE_KEY} inline-flex items-center gap-2 px-3.5 py-1.5 aria-disabled:cursor-default aria-disabled:text-foreground/40 aria-disabled:shadow-[var(--key-shadow-pressed)] aria-disabled:active:translate-y-0`}
      >
        <SyncMark spinning={pending} />
        Sync
      </button>

      {/* The abbreviation is for the eye alone. Without `aria-hidden` the live
          region below reads the same press twice — once short, once whole. */}
      {note && (
        <span
          aria-hidden
          title={note.title}
          className={`min-w-0 truncate font-mono text-[length:var(--fs-11)] uppercase tracking-[0.14em] ${
            note.alert ? "text-error" : "text-foreground/60"
          }`}
        >
          {note.text}
        </span>
      )}

      {/* **Always rendered, empty when there is nothing to say.** A live region
          inserted into the DOM in the same commit as its text is not reliably
          announced — the region has to already be in the accessibility tree
          when the words land. One per card rather than one for the page, so the
          announcement is about the league whose key was pressed without every
          sentence having to name it. Polite, not `role="alert"`: interrupting a
          reader over a press they just made is rude, and the tone is carried by
          the words and by `text-error` beside them. */}
      <span role="status" className="sr-only">
        {note?.title ?? ""}
      </span>
    </div>
  );
}

/**
 * The rotor. `animate-spin` with `motion-reduce:animate-none` rather than a
 * `.lab-anim` class, because the motion is a Tailwind utility rather than an
 * inline style — and nothing is lost when it stops, since "Syncing…" beside it
 * is the real signal.
 */
function SyncMark({ spinning }: { spinning: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className={`size-3.5 shrink-0 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <path d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89" />
      <path d="M13.6 1.9v3.2h-3.2" />
    </svg>
  );
}
