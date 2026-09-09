"use client";

import { CONSOLE_KEY_PILL_BARE } from "@/features/shared";

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
 *
 * **It sits on the seam itself, at the right end, and owns no row of its own.**
 * It stood in a 32px recess strip until the panel's height was counted: a
 * recess is the stock a *rail* is cut into, and 42px of a capped panel on one
 * key and a status note is height the two lists under it want more. So the key
 * is **etched** — `--recess-bg` under a hairline lip, the surface
 * `BILLET_KEY_CHROME` names for a key on a machined face. It then hung on a
 * 22px row of its own under the cut, with a hairline running out to the panel's
 * right edge to close that row; the row and its hairline went when the `Checks`
 * key arrived, because the seam's own groove was already the line and a second
 * one 8px under it was a rule drawn twice. It is `ExpandedPanel`'s `seamEnd`
 * now, right-aligned against the panel's gutter, the note leading the key so
 * the pair reads inward from the edge. The wrapper the panel gives it is the
 * one shrinkable thing on the row, which is what lets the note truncate on a
 * phone rather than push the row past the panel.
 *
 * **The key composes the *bare* pill, not the shell and not `CONSOLE_KEY`.**
 * Appending a smaller padding to that constant's `px-4 py-2` is decided by
 * Tailwind's emit order rather than by the class attribute — and the scale is
 * emitted ascending, so the *larger* value wins whatever is written. The shell
 * is the same trap one property over: its `text-[length:var(--fs-11)]` and
 * `tracking-[0.16em]` are arbitrary values, so a caller writing `--fs-10`
 * beside them is a coin flip too. The bare shape names neither, which is what
 * it exists for.
 *
 * **22px is under the 24px a coarse pointer wants, so it grows there** —
 * `touch:h-7` on the key and on the row that holds it, which is the
 * cheap arm rather than keeping a second recess-pill layout below `sm`. It is
 * still short of 44px, which is the same trade every control on a pane ledge
 * one seam down already makes: a card's own controls are read at arm's length
 * beside the lists they act on, and a 44px floor here is 22px off both.
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
    <div className="flex min-w-0 items-center gap-2">
      {/* The abbreviation is for the eye alone. Without `aria-hidden` the live
          region below reads the same press twice — once short, once whole. It
          leads the key because the pair sits at the row's right end and reads
          inward from the edge; the DOM order is the visual one, so a keyboard
          reader lands on the key with the note already announced beside it. */}
      {note && (
        <span
          aria-hidden
          title={note.title}
          className={`min-w-0 truncate font-mono text-[length:var(--fs-10)] uppercase tracking-[0.14em] ${
            note.alert ? "text-error" : "text-foreground/60"
          }`}
        >
          {note.text}
        </span>
      )}

      <button
        type="button"
        onClick={() => void press()}
        aria-disabled={pending}
        // "Sync" leads, so the visible label is a prefix of the accessible one
        // and a reader speaking the words on screen still hits this control.
        aria-label={`Sync ${leagueName} from Sleeper`}
        title="Re-read this league's rosters and this week's lineup from Sleeper"
        className={`${CONSOLE_KEY_PILL_BARE} inline-flex h-[22px] items-center gap-1.5 border-foreground/10 bg-[color:var(--recess-bg)] px-[9px] text-[length:var(--fs-10)] tracking-[0.14em] text-foreground/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] hover:text-readout aria-disabled:cursor-default aria-disabled:text-foreground/40 aria-disabled:active:translate-y-0 touch:h-7`}
      >
        <SyncMark spinning={pending} />
        Sync
      </button>

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
      className={`size-3 shrink-0 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
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
