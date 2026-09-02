/*
 * The colour scheme, and the one thing about it the server needs to know.
 *
 * No `"use client"` and no imports: `layout.tsx` is a server component and
 * renders `THEME_BOOT_SCRIPT` into the document head, while `theme-toggle.tsx`
 * reads the same key on the client. One spelling of the key, two sides of the
 * boundary.
 */

/** Dark is the default; `light` is the only value ever stored. */
export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "thelab:theme";

/**
 * Applies a stored theme before the browser's first paint.
 *
 * It has to be an inline script in the head, not an effect and not client
 * state: the script runs while the HTML is still being parsed, where anything
 * React does runs after hydration — which is after the server's markup has
 * already been painted in the default scheme. A reader who chose light would
 * see the dark console flash first on every hard load.
 *
 * `try`/`catch` because storage can be blocked, in which case the default
 * stands. Nothing is written for dark: the absence of the attribute is what
 * `globals.css` reads as dark, so an unset document is already correct.
 */
export const THEME_BOOT_SCRIPT =
  `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});` +
  `if(t)document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
