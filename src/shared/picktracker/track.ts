/**
 * The I/O for the pick tracker: fetch the league, its placeholder draft and
 * that draft's picks from Sleeper, then hand off to the pure functions in
 * `picks.ts`. Composition only — no logic of its own, so nothing here needs a
 * test.
 */
import {
  getDraftPicks,
  getLeague,
  getLeagueDrafts,
  getLeagueUsers,
} from "@/shared/sleeper";
import type { SleeperLeague } from "@/shared/sleeper";

import {
  draftTeamCount,
  findPlaceholderDraft,
  nextPickLabel,
  placeholderPicks,
} from "./picks";
import type { PlaceholderPick } from "./picks";

/** A tracked draft, or a normalized failure with the HTTP status to return. */
export type PicktrackerResult =
  | {
      ok: true;
      league: SleeperLeague;
      draft_id: string;
      draft_status: string;
      teams: number;
      picks: PlaceholderPick[];
      next_pick: string | null;
    }
  | { ok: false; status: 404 | 502; error: string };

/**
 * Track a league's placeholder draft. Every read here is fatal — the picks are
 * the point of the route, and without the league or the draft there is nothing
 * to label them with — so failures normalize to a status rather than a partial
 * answer.
 */
export async function trackPlaceholderDraft(
  leagueId: string,
): Promise<PicktrackerResult> {
  let league: SleeperLeague | null;
  let drafts: Awaited<ReturnType<typeof getLeagueDrafts>>;
  try {
    [league, drafts] = await Promise.all([
      getLeague(leagueId),
      getLeagueDrafts(leagueId),
    ]);
  } catch {
    return { ok: false, status: 502, error: "Failed to reach Sleeper" };
  }

  if (!league) {
    return { ok: false, status: 404, error: "League not found" };
  }

  const draft = findPlaceholderDraft(drafts);
  if (!draft) {
    return {
      ok: false,
      status: 404,
      error: "No draft in this league has a kicker slot to use as placeholders",
    };
  }

  const teams = draftTeamCount(draft);
  if (teams === 0) {
    return {
      ok: false,
      status: 404,
      error: "The draft has no teams yet, so picks can't be numbered",
    };
  }

  let draftPicks: Awaited<ReturnType<typeof getDraftPicks>>;
  let users: Awaited<ReturnType<typeof getLeagueUsers>>;
  try {
    [draftPicks, users] = await Promise.all([
      getDraftPicks(draft.draft_id),
      getLeagueUsers(leagueId),
    ]);
  } catch {
    return { ok: false, status: 502, error: "Failed to reach Sleeper" };
  }

  const picks = placeholderPicks(draftPicks, users, teams);

  return {
    ok: true,
    league,
    draft_id: draft.draft_id,
    draft_status: draft.status,
    teams,
    picks,
    next_pick: nextPickLabel(draft, picks.length, teams),
  };
}
