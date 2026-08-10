/**
 * Freeze a value and everything reachable through it.
 *
 * **For values that are shared rather than owned.** A cached read
 * ({@link TtlPromiseCache}) hands the *same object* to every caller for the
 * length of its TTL, so a route that sorted the rows in place, or annotated one
 * of them, would be editing the answer every later reader gets — a bug that
 * appears on the second request and never on the first, which is the hardest
 * kind to reproduce. Frozen, that edit throws where it is written: module code
 * is strict mode, so a write to a frozen property is a `TypeError` rather than a
 * silent no-op.
 *
 * The cost is paid once per cache fill and not per read, which is what makes it
 * affordable on a thousand-row ADP board: a few thousand `Object.freeze` calls
 * every ten minutes, against the second of aggregate the entry stands in for.
 *
 * Two details. It freezes **before** it recurses, so a cyclic value terminates
 * — an already-frozen node is skipped, and the node a cycle comes back to is one
 * of those. And it reaches plain objects and arrays and stops there: a `Map` or
 * `Set` accepts `Object.freeze` and goes on accepting `set`/`add`, so freezing
 * one would be a guarantee this cannot keep. Nothing cached through here holds
 * either; a value that does wants a readonly view instead.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;

  Object.freeze(value);
  for (const inner of Object.values(value as Record<string, unknown>)) {
    deepFreeze(inner);
  }
  return value;
}
