/**
 * Split a growing NDJSON buffer into whole lines, returning the unconsumed
 * remainder.
 *
 * A chunk off a stream reader has no obligation to end on a newline — one JSON
 * object can arrive across two reads, and two can arrive in one — so the tail
 * is handed back rather than parsed. Lives beside its one consumer for now; it
 * moves to `features/shared` when a second stream reads one.
 *
 * **`from` is how far the caller has already looked.** The leagues stream's
 * closing `result` is one ~519KB line that arrives over many reads, and a
 * buffer split on every read is quadratic over it: each chunk re-walked every
 * byte held since the last newline. The caller knows that everything it is
 * holding back has been scanned and found newline-free, so it says so, and a
 * read that lands no newline past that point returns the buffer untouched —
 * one `indexOf` over the new bytes rather than a split over the whole. Where a
 * newline *is* found the whole buffer is split, which is right whatever the
 * offset claims, since the held prefix contains none by the caller's own
 * promise. Omitted, it is the whole buffer, which is the old behaviour to the
 * byte.
 */
export function takeLines(
  buffer: string,
  from = 0,
): { lines: string[]; rest: string } {
  if (buffer.indexOf("\n", from) === -1) return { lines: [], rest: buffer };
  const parts = buffer.split("\n");
  // The last piece has no terminating newline yet — hold it for the next chunk.
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}
