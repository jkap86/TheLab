/**
 * Split a growing NDJSON buffer into whole lines, returning the unconsumed
 * remainder.
 *
 * A chunk off a stream reader has no obligation to end on a newline — one JSON
 * object can arrive across two reads, and two can arrive in one — so the tail
 * is handed back rather than parsed. Lives beside its one consumer for now; it
 * moves to `features/shared` when a second stream reads one.
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  // The last piece has no terminating newline yet — hold it for the next chunk.
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}
