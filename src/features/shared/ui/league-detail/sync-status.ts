import type { LeagueSyncPayload } from "@/shared/contract";

/**
 * What a press of the panel's sync key is worth saying back.
 *
 * Pure and beside the component for the reason `head-to-head` and `player-game`
 * are: the rule is two sentences and every way of getting it wrong renders
 * perfectly well. A press whose answer is invisible reads as a broken key, and a
 * press that announces a success nobody asked to be told about reads as noise —
 * and which of those a given status lands on cannot be seen from the markup.
 *
 * Everything arrives as an erased `import type`, so the tests drive it with a
 * relative `.ts` import and nothing behind it.
 */

/** A note beside the key, or null where the rows say it better than words. */
export type SyncStatusNote = {
  /** The word on the band, which has a truncating cell's worth of room. */
  text: string;
  /** The same answer for a reader who cannot see the key — a whole sentence. */
  speech: string;
  /** Amber for a press that fetched nothing, quiet for one that merely waited. */
  tone: "muted" | "attention";
};

/**
 * The note for the last press, or null for silence.
 *
 * Two rules, and they are opposite sides of one question — *did the reader learn
 * anything they could not see?*
 *
 * - **A success says nothing.** `synced` and `fresh` both mean the stored league
 *   is current, and the refetch they trigger is what the reader is looking at:
 *   the rows change, or they were already right. A "Synced" badge beside them
 *   would be the key congratulating itself, and it would be the only permanent
 *   text on a band that is otherwise a control.
 * - **Everything that fetched nothing speaks**, because those are the presses
 *   that leave the screen exactly as it was. A reader who has just changed a
 *   lineup and pressed this is otherwise looking at unchanged rows with no way to
 *   tell whether the app is behind or their memory is.
 *
 * Nothing here is an alarm. A cooldown and a running refresh are ordinary
 * operation, so they are quiet; only the two that mean *this league could not be
 * read* take the attention tone — the app's amber, the one the lineup shortfall
 * already wears — and even they are a note rather than an alert, since a press
 * that says "ask again in a moment" has no business interrupting anybody.
 */
export function syncStatusNote(
  pending: boolean,
  result: LeagueSyncPayload | null,
  error: string | null,
): SyncStatusNote | null {
  // A press in flight is reported by the key itself — its label and its turning
  // mark — so a note beside it would be the same fact twice on one band.
  if (pending) return null;

  // A transport failure never reached the route, so there is no status to read;
  // the server's own message is what a reader gets, since it is the only thing
  // that can say more than "it didn't work".
  if (error) return { text: "Sync failed", speech: error, tone: "attention" };
  if (!result) return null;

  switch (result.status) {
    case "cooldown":
      return {
        text: "Just synced",
        // The wait is spelled out for the reader who cannot see the key: "just
        // synced" beside a live control is a state they would otherwise have to
        // guess the duration of. Rounded *up*, so a countdown never tells
        // somebody to press again a moment before the server would accept it.
        speech: `Already refreshed moments ago. Try again in ${Math.max(
          1,
          Math.ceil(result.retry_after_ms / 1000),
        )} seconds.`,
        tone: "muted",
      };
    case "locked":
      return {
        text: "Syncing elsewhere",
        speech: "A refresh of this league is already running. Try again shortly.",
        tone: "muted",
      };
    case "gone":
      return {
        text: "League gone",
        speech: "Sleeper no longer has this league.",
        tone: "attention",
      };
    case "failed":
      return {
        text: "Sync failed",
        speech: "Sleeper could not be read for this league.",
        tone: "attention",
      };
    default:
      return null;
  }
}

/**
 * ` · last updated …` for the key's hover, or nothing where we cannot say.
 *
 * The hover rather than the band, because it is context for the control and not
 * an answer to the press — and it is the one thing a *refused* answer can still
 * state honestly, which is the difference between "somebody refreshed this four
 * seconds ago" and "we have never managed to read it".
 *
 * An unparseable timestamp is silence rather than `Invalid Date`: this string
 * exists to reassure, and a broken one does the opposite of that. The clock is
 * the reader's own local time, the `todayIso` side of the two-todays rule — it
 * names a moment in their day rather than making a claim about the NFL's.
 */
export function lastUpdatedNote(result: LeagueSyncPayload | null): string {
  if (!result?.updated_at) return "";
  const at = new Date(result.updated_at);
  return Number.isNaN(at.getTime())
    ? ""
    : ` · last updated ${at.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
}
