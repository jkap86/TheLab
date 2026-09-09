import type { LeagueSyncPayload } from "@/shared/contract";

/**
 * What a sync key says about the press just made.
 *
 * Pure, with the contract arriving as an erased `import type`, so this tests
 * under Node's runner with no render behind it — the bar
 * `./lineup-check-metrics` sets, and the reason the rule below is pinned rather
 * than merely intended.
 *
 * **The rule is that a success says nothing and every other press speaks.** A
 * press that worked is answered by the numbers on the card changing; a "Synced!"
 * badge on top of that is the key congratulating itself, and on a page of a
 * hundred cards it is a hundred badges. A press that fetched nothing leaves the
 * screen exactly as it was, which is indistinguishable from a dead key unless
 * something says otherwise — so those are the ones that get words.
 *
 * There is no clock in here and there must not be: `retry_after_ms` is the
 * server's own measurement, and a note that counted down against a second clock
 * would disagree with the only authority there is. See `LeagueSyncKey` for why
 * the key itself is not disabled for the duration either.
 */

/** One line of news about a press. Deliberately {@link MetricCell}'s shape. */
export type SyncNote = {
  /** The abbreviation for the eye. */
  text: string;
  /** Whether it names something wrong, as opposed to something not done. */
  alert: boolean;
  /** The whole sentence — the tooltip, and what a screen reader is given. */
  title: string;
};

/**
 * Seconds the server is still refusing for.
 *
 * `ceil`, so a reader told "2s" who waits two seconds is not refused again; and
 * floored at 1, because `retry_after_ms` can round to zero and "wait 0 seconds"
 * under a key that is actively refusing is a contradiction the reader acts on.
 */
const waitSeconds = (ms: number): number => Math.max(1, Math.ceil(ms / 1000));

export function syncStatusNote(
  pending: boolean,
  result: LeagueSyncPayload | null,
  error: string | null,
): SyncNote | null {
  // Pending outranks the last answer, so a stale refusal never sits under a
  // live press. It is also the only acknowledgement a press gets before it
  // lands — the key keeps its own label — so it speaks rather than going quiet.
  if (pending) {
    return {
      text: "Syncing…",
      alert: false,
      title: "Re-reading this league from Sleeper",
    };
  }
  // The press never reached an answer: a dead network, a 500, a 404. Carries the
  // server's own words rather than ours, since it took the trouble to send some.
  if (error) return { text: "Couldn't sync", alert: true, title: error };
  if (!result) return null;

  // **The one silence**, and it is read off `synced` rather than matched as two
  // statuses — the same field the caller gates its re-read on, so the note and
  // the re-read can never come to different conclusions about one press. It
  // covers `fresh` as well as `synced`: a race lost to somebody else's refresh
  // still leaves the reader looking at current data, which is what they asked
  // for, and an explanation of the plumbing is not news.
  if (result.synced) return null;

  switch (result.status) {
    case "cooldown": {
      const s = waitSeconds(result.retry_after_ms);
      return {
        text: `Wait ${s}s`,
        alert: false,
        title: `Synced a moment ago — try again in ${s} second${s === 1 ? "" : "s"}`,
      };
    }
    case "locked":
      return {
        text: "Sync running",
        alert: false,
        title:
          "A sync of this league is already running — press again in a moment to see it",
      };
    case "gone":
      return {
        text: "Gone from Sleeper",
        alert: true,
        title: "Sleeper no longer has this league — there is nothing left to sync",
      };
    case "failed":
      return {
        text: "Sync failed",
        alert: true,
        title:
          "Sleeper was reached and did not answer in full — these numbers are the last good read",
      };
    default:
      // A status this build has no words for still speaks, naming the raw value:
      // the habit `SLOT_LABELS` keeps, and the alternative is a press that
      // silently does nothing the day the server learns a new answer.
      return {
        text: "Not synced",
        alert: true,
        title: `The sync answered "${String(result.status)}", which this build has no words for`,
      };
  }
}
