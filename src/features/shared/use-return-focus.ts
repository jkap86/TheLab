"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Put the focus back on a control whose floating panel has just closed.
 *
 * Every popover in this app closes on Escape, on a press outside, and on a
 * second press of its own trigger — and the first of those is the one that
 * strands a keyboard reader. Escape is handled by an ancestor (the drawer's key
 * listener, the filters dialog's `cancel`, the panel that owns "one picker at a
 * time"), so what closes is a subtree the focused element was *inside*: the
 * element is removed, and the browser drops focus onto `<body>`. From there the
 * next Tab restarts at the top of the document, which on a pinned-header page is
 * several dozen stops from where the reader was.
 *
 * **It only fires when the focus was genuinely lost**, which is what keeps it
 * from fighting the other two close paths. A press outside moves the focus to
 * whatever was pressed, and a press on the trigger leaves it there — in both
 * cases `document.activeElement` is a real element and this does nothing. Only
 * the "focus fell to `body`" case is corrected, so this can be applied to a
 * control without auditing how it is dismissed.
 *
 * The pattern was written inline in `AdpRangeControl` first; a second and third
 * reader is what moved it here.
 */
export function useReturnFocus(
  open: boolean,
  trigger: RefObject<HTMLElement | null>,
): void {
  const wasOpen = useRef(open);

  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed) return;
    // `null` is what a detached document reports; `body` is what a browser
    // leaves behind when the focused element is unmounted under it.
    const active = document.activeElement;
    if (active === null || active === document.body) trigger.current?.focus();
  }, [open, trigger]);
}
