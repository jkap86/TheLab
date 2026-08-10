"use client";

import { useCallback, useState } from "react";

/**
 * Whether something behind a press is open, and whether it has ever been.
 *
 * The second half is the *latch*, and it is what a `dynamic()` import needs:
 * mounting is what downloads the chunk, so a panel unmounted the instant it
 * closes is a component disappearing inside its own close handler and a chunk
 * the browser already has being waited for again on the next press. It is also
 * what keeps state the control accumulated while it was open — the trade search
 * remembers names for tokens the loaded pages never named, and losing those on a
 * collapse is a visible regression rather than a slow one.
 *
 * **It exists so the latch is set from the press rather than from the render
 * body**, which is the correction it was extracted for. Three call sites spelled
 * it as
 *
 * ```
 * if (open && !everOpened) setEverOpened(true);
 * ```
 *
 * — a render-phase update: legal, and it makes opening the panel a second
 * synchronous pass over the whole page before React commits anything. That pass
 * lands in the same frame as the dialog mounting, the lazy chunk evaluating and
 * (on the trades board) two network reads starting, which is already the most
 * expensive frame those pages have. Folded into the handler, the latch and the
 * open are one batched update and the render body is a function of its props
 * again. `shared/sheet-latch` made the same correction for the shares browses,
 * where the open state is *which* sheet rather than a boolean; this is the
 * boolean case, which is the other three.
 *
 * `show`/`hide`/`toggle` are stable, so a control taking one as a prop is not
 * re-rendered by this hook.
 */
export function useLatchedDisclosure(): {
  /** Whether it is open now. */
  open: boolean;
  /** Whether it has ever been opened — render it on this, not on `open`. */
  mounted: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
} {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);

  const hide = useCallback(() => setOpen(false), []);

  // Latched unconditionally: a toggle that opens has to mount, and one that
  // closes was already mounted, so there is no case where this is wrong. Setting
  // it to the value it already holds is a no-op React bails out of rather than a
  // render. The flip is an updater so it reads the state React is about to
  // commit rather than the one this closure captured, and nothing but the flip
  // happens inside it — an updater that called another setter would run twice
  // under StrictMode.
  const toggle = useCallback(() => {
    setMounted(true);
    setOpen((wasOpen) => !wasOpen);
  }, []);

  return { open, mounted, show, hide, toggle };
}
