/**
 * Split a growing NDJSON buffer into whole lines, returning the unconsumed
 * remainder. Shared by the two stream hooks (`useManagerLeagues`,
 * `useUserLeagues`): they deliberately differ in what they guarantee, but the
 * line-splitting is protocol, not guarantee, and two copies of it is the drift
 * the `shared/query` primitives were consolidated to stop.
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  // The last piece has no terminating newline yet — hold it for the next chunk.
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}
