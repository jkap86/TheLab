/**
 * What kind of pointer is reading the page, asked of the platform rather than of
 * the user agent string.
 *
 * The one thing this is for: whether a panel that opens may take the focus. On a
 * mouse a focused search field is the whole point — the reader opened the browse
 * to type, and a first keystroke landing on the page behind it is a lost
 * keystroke. On a phone focus *is* the software keyboard, which covers half the
 * list, resizes the visual viewport under a sheet that is sized in `vh`, and
 * answers a question nobody asked: the shares browse is opened to be scrolled at
 * least as often as it is opened to be searched, and the field is one tap away
 * either way.
 *
 * `(pointer: fine)` describes the *primary* input, which is exactly the question
 * — a laptop with a touchscreen answers true because its mouse is what it is
 * mainly driven by, and an iPad with a keyboard attached still answers false.
 * A UA test would have to enumerate devices to say the same thing, and would be
 * wrong about the next one.
 */

/** The query that separates a mouse from a finger. */
export const FINE_POINTER_QUERY = "(pointer: fine)";

/** As much of `window.matchMedia` as this needs. */
export type MatchMedia = (query: string) => { matches: boolean } | null | undefined;

/**
 * Whether the primary pointer is a fine one.
 *
 * **Unknown answers false**, which is the asymmetry worth stating: a server
 * render, an engine without `matchMedia`, or a call that throws all end up here,
 * and the two mistakes are not equal. Autofocus withheld from a desktop reader
 * costs one click on a field they can see. Autofocus given to a phone throws a
 * keyboard over the list they came to read, on a page that is already the
 * heaviest thing this app draws.
 */
export function hasFinePointer(matchMedia: MatchMedia | null | undefined): boolean {
  if (typeof matchMedia !== "function") return false;
  try {
    return matchMedia(FINE_POINTER_QUERY)?.matches === true;
  } catch {
    // Some engines throw on a query they cannot parse rather than answering
    // `false`, and a throw inside an effect is the failure `dialog-open` exists
    // to keep out of this path.
    return false;
  }
}
