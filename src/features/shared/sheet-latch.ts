/**
 * Which of the two shares browses have ever been opened.
 *
 * The rail loads each sheet with its own `dynamic()` — the players half carries
 * the ADP apparatus the leaguemates half has no column for — so *mounting* is
 * what downloads a chunk, and a reader who only ever browses players must never
 * pay for the other one. The latch is what turns "is this one open" into "has
 * this one ever been open": a dialog unmounted inside its own close handler is a
 * component disappearing mid-event, and re-mounting it on the next press is a
 * chunk the browser already has being waited for again.
 *
 * It is a pure fold rather than an inline `setState` so that the thing that used
 * to be wrong about it cannot come back. The latch was applied *in the render
 * body* —
 *
 * ```
 * if (sheet && !mounted.includes(sheet)) setMounted([...mounted, sheet]);
 * ```
 *
 * — which is a render-phase update: legal, and it makes opening a sheet cost a
 * second synchronous pass over the whole rail before React commits anything.
 * That pass lands in the same frame as the dialog mounting, the two lazy chunks
 * evaluating, and (for players) the roster and ADP reads starting, which on a
 * phone is the frame that was already the most expensive in the app. Folded in
 * the press handler instead, the latch and the open are one batched update and
 * the render body is a function of its props again.
 */

/** The kinds of subject a browse can be over — see `SubjectKind`. */
export type LatchKind = string;

/**
 * `mounted` with `kind` latched in, or `mounted` itself when it is already
 * there.
 *
 * Returning the same array on a no-op is the half that matters: this is called
 * from a `setState` updater on every press, and a fresh array would re-render
 * both sheets — including the one that is *not* being opened — every time the
 * other is.
 */
export function latchSheet<K extends LatchKind>(
  mounted: readonly K[],
  kind: K,
): readonly K[] {
  return mounted.includes(kind) ? mounted : [...mounted, kind];
}

/**
 * The open sheet after `kind` reports itself closed.
 *
 * It clears only its own kind, because a sheet closing is the last thing that
 * happens on the way out of it: a flat `null` would have one dialog's exit
 * cancel whatever had just been asked for — pressing Leaguemates while the
 * players sheet is on its way down.
 */
export function closeSheet<K extends LatchKind>(open: K | null, kind: K): K | null {
  return open === kind ? null : open;
}
