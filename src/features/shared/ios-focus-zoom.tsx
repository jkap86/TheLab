"use client";

import { useEffect } from "react";

/**
 * iOS and iPadOS, including an iPad asking for the desktop site — which
 * reports itself as a Mac and gives itself away only by having a touchscreen.
 * That arm reads the user agent's `Macintosh` rather than `navigator.platform`,
 * which Chrome leaves at `MacIntel` while spoofing an Android phone: on the
 * platform, a desktop emulator reads as an iPad.
 */
function isIos(): boolean {
  const { userAgent, maxTouchPoints } = window.navigator;
  return (
    /iP(hone|od|ad)/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

/**
 * Stops iOS Safari zooming the page when a text field takes focus, and does
 * nothing anywhere else.
 *
 * **The 17px font floor in `globals.css` was meant to be the whole fix and did
 * not hold on a device**: tapping the shares drawer's search field still
 * zoomed. `maximum-scale=1` is the fix Safari reliably honours, and **on iOS it
 * costs nobody their pinch-zoom** — Safari has ignored `maximum-scale` and
 * `user-scalable` for the reader's own gestures since iOS 10, and still uses
 * `maximum-scale` to decide whether a focus may zoom. That leaves the WCAG
 * 1.4.4 argument in `layout.tsx` intact. Chrome on Android is where it would
 * break that argument, since Chrome *does* stop pinch-zoom for it, and that is
 * why this is scoped to iOS rather than written into the `viewport` export —
 * Android does not zoom a focused field in the first place.
 *
 * **Client-side, not a `generateViewport` reading the user agent**: a request
 * header read in the root layout opts the whole app out of static prerendering,
 * the cost `theme.ts` refuses a cookie for. An effect is early enough — nothing
 * focusable does anything before hydration — and runs after it, so the edited
 * attribute is never a hydration mismatch. React only rewrites an attribute
 * whose *prop* changed, and the root layout's viewport never does.
 *
 * The font floor stays: it is still what keeps a focused field legible on a
 * touchscreen, and belt and braces on the device this was reported from.
 */
export function IosFocusZoomGuard() {
  useEffect(() => {
    if (!isIos()) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!meta || /maximum-scale/.test(meta.content)) return;
    meta.content = `${meta.content}, maximum-scale=1`;
  }, []);
  return null;
}
