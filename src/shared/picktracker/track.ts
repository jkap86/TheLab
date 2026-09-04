/**
 * The I/O for the pick tracker: fetch the league, its placeholder draft and
 * that draft's picks from Sleeper, then hand off to the pure functions in
 * `picks.ts`. Composition only — no logic of its own, so nothing here needs a
 * test.
 *
 * **It is split in two, and the split is a design decision rather than an
 * optimisation.** A league's name, its avatar and its member list do not change
 * while a draft runs, so a live tick has no business re-reading them:
 * {@link trackPlaceholderDraft} makes the four-call read once and hands back
 * the immutable half as a {@link PicktrackerContext}, and
 * {@link retrackPlaceholderDraft} re-reads only the two things that move. That
 * is what makes a 15-second poll affordable — 8 Sleeper calls a minute for a
 * whole room, against the 1000/minute Sleeper documents.
 *
 * Every read here is fatal on the *first* load, because the picks are the point
 * and without the league or the draft there is nothing to label them with. A
 * failing tick against a board already on screen is a different question and is
 * `live.ts`'s to answer.
 */
import {
  cacheBustToken,
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueUsers,
} from "@/shared/sleeper";
import type { SleeperLeague, SleeperLeagueUser } from "@/shared/sleeper";

import {
  draftTeamCount,
  findPlaceholderDraft,
  nextPickLabel,
  placeholderPicks,
} from "./picks";
import type { PlaceholderPick } from "./picks";

/** Everything a board needs that does not change while the draft runs. */
export type PicktrackerContext = {
  league: SleeperLeague;
  draft_id: string;
  teams: number;
  users: SleeperLeagueUser[];
};

/** A tracked draft, or a normalized failure with the HTTP status to return. */
export type PicktrackerResult =
  | {
      ok: true;
      context: PicktrackerContext;
      draft_status: string;
      picks: PlaceholderPick[];
      next_pick: string | null;
      /**
       * Epoch ms of the draft's most recent pick, straight from Sleeper, or
       * null where nobody has picked yet. Carried out of here purely so
       * `live.ts` can build a change signature from it — read it as "the
       * running edge", never as an end, until `draft_status` says `complete`.
       */
      last_picked: number | null;
    }
  | { ok: false; status: 404 | 502; error: string };

const NO_KICKER_SLOT =
  "No draft in this league has a kicker slot to use as placeholders";
const NO_TEAMS = "The draft has no teams yet, so picks can't be numbered";
const UNREACHABLE = "Failed to reach Sleeper";

/**
 * Mint a cache-busting token for one read of the graph.
 *
 * **The pick tracker is the second minter, after `refreshLeague`.** Sleeper's
 * API sits behind a CDN, and a board served from a copy taken before the last
 * pick is the one failure this feature cannot have: the room is looking at the
 * pick that was just made. One token per read, shared by every call that read
 * makes, so a board is assembled from one instant rather than from four.
 */
const freshToken = () => cacheBustToken();

/**
 * Track a league's placeholder draft from nothing: four Sleeper reads, the
 * context included.
 */
export async function trackPlaceholderDraft(
  leagueId: string,
): Promise<PicktrackerResult> {
  const fresh = freshToken();

  let league: SleeperLeague | null;
  let drafts: Awaited<ReturnType<typeof getLeagueDrafts>>;
  try {
    [league, drafts] = await Promise.all([
      getLeague(leagueId, fresh),
      getLeagueDrafts(leagueId, fresh),
    ]);
  } catch {
    return { ok: false, status: 502, error: UNREACHABLE };
  }

  if (!league) return { ok: false, status: 404, error: "League not found" };

  const draft = findPlaceholderDraft(drafts);
  if (!draft) return { ok: false, status: 404, error: NO_KICKER_SLOT };

  const teams = draftTeamCount(draft);
  if (teams === 0) return { ok: false, status: 404, error: NO_TEAMS };

  let draftPicks: Awaited<ReturnType<typeof getDraftPicks>>;
  let users: Awaited<ReturnType<typeof getLeagueUsers>>;
  try {
    [draftPicks, users] = await Promise.all([
      getDraftPicks(draft.draft_id, fresh),
      getLeagueUsers(leagueId, fresh),
    ]);
  } catch {
    return { ok: false, status: 502, error: UNREACHABLE };
  }

  const picks = placeholderPicks(draftPicks, users, teams);

  return {
    ok: true,
    context: { league, draft_id: draft.draft_id, teams, users },
    draft_status: draft.status,
    picks,
    next_pick: nextPickLabel(draft, picks.length, teams),
    last_picked: draft.last_picked,
  };
}

/**
 * Re-read only what moves: the draft (for its status and running edge) and its
 * picks. Two calls against a context already in hand.
 *
 * **The draft is re-read rather than inferred.** Completion could be guessed
 * from `picks.length` against the round count, but that is arithmetic standing
 * in for a fact Sleeper will state — the same reason `nextPickLabel` gates on
 * `status` rather than on a slot that still looks plausible.
 *
 * A draft that has vanished from the league between ticks answers 404 rather
 * than silently holding the last board: the league was re-read to find it, so
 * its absence is an answer and not a gap.
 */
export async function retrackPlaceholderDraft(
  context: PicktrackerContext,
): Promise<PicktrackerResult> {
  const fresh = freshToken();

  let drafts: Awaited<ReturnType<typeof getLeagueDrafts>>;
  let draftPicks: Awaited<ReturnType<typeof getDraftPicks>>;
  try {
    [drafts, draftPicks] = await Promise.all([
      getLeagueDrafts(context.league.league_id, fresh),
      getDraftPicks(context.draft_id, fresh),
    ]);
  } catch {
    return { ok: false, status: 502, error: UNREACHABLE };
  }

  // Matched by id rather than re-running `findPlaceholderDraft`: a room is
  // following one draft, and a league that grew a second kicker draft mid-room
  // must not have the board silently change subject underneath its readers.
  const draft = drafts.find((d) => d.draft_id === context.draft_id);
  if (!draft) return { ok: false, status: 404, error: NO_KICKER_SLOT };

  const picks = placeholderPicks(draftPicks, context.users, context.teams);

  return {
    ok: true,
    context,
    draft_status: draft.status,
    picks,
    next_pick: nextPickLabel(draft, picks.length, context.teams),
    last_picked: draft.last_picked,
  };
}
