import type { HttpError } from "@/shared/http";

/**
 * Whether a failed Sleeper request means "no such thing" rather than a fault.
 *
 * Pure and split out of the client because it is the whole decision behind
 * `sleeperGetOptional`, and both ways of getting it wrong are silent. Matching
 * too little leaves a caller throwing on an answer it could have acted on.
 * Matching too much is worse and quieter: a fallback returned for a fault
 * persists as though Sleeper had said the collection is empty.
 */

/**
 * True only for HTTP 404 on a response Sleeper actually sent.
 *
 * **Only 404, deliberately not "any 4xx".** A 429 folded into a fallback is a
 * rate-limited read writing empty collections over rows that were fine, and a
 * 403 is a client this app has to fix rather than a resource that is absent.
 * Both are faults, and a fault has to keep throwing.
 *
 * **And only where there is a response.** A timeout, a DNS failure or any other
 * non-HTTP throw carries no `response`, and that is exactly the case that must
 * stay an error: nothing was learned about whether the resource exists, so
 * folding it would invent an answer out of a connection problem.
 */
export function isMissingResource(error: unknown): boolean {
  return (error as HttpError | undefined)?.response?.status === 404;
}
