"use client";

import { useLayoutEffect } from "react";

import { readLocal, writeLocal } from "./local-store";
import { THEME_STORAGE_KEY, type Theme } from "./theme";

/**
 * Flips between the two schemes and remembers the choice.
 *
 * The theme lives on `<html>` as `data-theme`, not in React state, and this
 * button holds none: it renders both faces and lets `globals.css` show the one
 * that matches. The reason is the inline boot script — the DOM already knows
 * the answer before React exists, so state here could only ever repeat it a
 * frame late, and on the first paint it would be wrong.
 *
 * `className` is the chrome, because the call sites do not share one: the app
 * rack draws it as a key with a legend and the tools console as a bare key.
 * What is shared is everything below the paint.
 */
export function ThemeToggle({
  className = DEFAULT_CHROME,
  labelClassName,
}: {
  className?: string;
  /**
   * Set to render the name of the theme a press switches *to* beside the
   * glyph — the rack's "Light" / "Dark" legend, which it hides again below
   * `md`. Absent means the icon alone.
   *
   * The word is `aria-hidden` rather than being the button's name: each face
   * already carries a full sentence, and a visible "Light" would only prepend
   * a redundant token to it.
   */
  labelClassName?: string;
}) {
  // React's dev-only Strict Mode remount resets `<html>` to the attributes it
  // manages from JSX, which clears the one the boot script set — the stored
  // theme would silently revert to the default in `next dev` and nowhere else.
  // A layout effect runs before paint, so re-applying here is invisible. This
  // is a no-op in production. See Next's `preventing-flash-before-hydration`.
  useLayoutEffect(() => {
    const stored = readLocal(THEME_STORAGE_KEY);
    if (stored) document.documentElement.dataset.theme = stored;
  }, []);

  const toggle = () => {
    // Read the document, not a prop: it is the source of truth the script,
    // the CSS and the dev remount all agree on. Absent means dark.
    const next: Theme =
      document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    writeLocal(THEME_STORAGE_KEY, next);
  };

  return (
    <button type="button" onClick={toggle} className={className}>
      {/* Each face carries its own label, so the accessible name follows the
          cascade too: a `display: none` face is out of the tree entirely,
          where a single `aria-label` would have to be set from state. */}
      <span className="theme-when-dark items-center gap-2">
        <SunMark />
        {labelClassName !== undefined && (
          <span aria-hidden className={labelClassName}>
            Light
          </span>
        )}
        <span className="sr-only">Switch to the light theme</span>
      </span>
      <span className="theme-when-light items-center gap-2">
        <MoonMark />
        {labelClassName !== undefined && (
          <span aria-hidden className={labelClassName}>
            Dark
          </span>
        )}
        <span className="sr-only">Switch to the dark theme</span>
      </span>
    </button>
  );
}

const DEFAULT_CHROME =
  "shrink-0 rounded-lg border border-foreground/15 px-3 py-2 text-foreground/70 " +
  "transition-colors hover:bg-foreground/5 hover:text-foreground " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground/50";

/** Shown while the theme is dark: the light you would switch to. */
function SunMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
    </svg>
  );
}

/** Shown while the theme is light. */
function MoonMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z" />
    </svg>
  );
}
