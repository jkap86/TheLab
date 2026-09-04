/**
 * Placeholder-pick tracking.
 *
 * Leagues that let startup-draft picks buy next year's rookie picks can't draft
 * a rookie who isn't in Sleeper's player pool yet, so managers draft kickers as
 * placeholders: the Nth kicker off the board stands for the Nth pick of the
 * coming rookie draft. What matters about a kicker pick is therefore its place
 * in the *kicker sequence*, not the startup slot it was made at — a kicker
 * taken 7.11 might be rookie pick 1.03. These functions renumber the kicker
 * picks into that rookie-draft order.
 *
 * Pure on purpose: inputs arrive as arguments and cross-module types come in
 * via `import type` (erased at runtime), so the tests resolve nothing but this
 * file — the arrangement `manager/draft-picks.ts` already uses to reach
 * `@/shared/contract` from under Node's own runner.
 */
import type {
  SleeperDraft,
  SleeperDraftPick,
  SleeperLeagueUser,
} from "@/shared/sleeper";

/** The manager who made a placeholder pick. `avatar` is a Sleeper avatar id. */
export type PlaceholderManager = {
  user_id: string;
  display_name: string;
  avatar: string | null;
};

/** One kicker pick, renumbered into the rookie-draft order it stands for. */
export type PlaceholderPick = {
  /** Round.slot in the placeholder sequence, e.g. "2.05". */
  pick: string;
  player_id: string;
  player_name: string;
  /** Null when nobody made the pick — Sleeper autopicks carry no user id. */
  picked_by: PlaceholderManager | null;
};

const settingNumber = (draft: SleeperDraft, key: string): number => {
  const value = draft.settings?.[key];
  return typeof value === "number" ? value : 0;
};

/**
 * The draft being used for placeholders: the first one with a kicker slot.
 * A league running this convention gives every team a K slot in the startup
 * draft; a league without one has nothing for this tool to track.
 *
 * **This is as narrow as the predicate can get, and the obvious tightening is
 * wrong.** It also matches every ordinary league that simply rosters a kicker,
 * whose kickers then get renumbered into a placeholder sequence nobody is
 * trading. The tempting fix is to ask whether the league *really* starts a
 * kicker — and it fails, because a league running the convention **still
 * carries `K` in its `roster_positions` while the draft is on**: that slot is
 * exactly what makes a kicker draftable in the first place. The two are
 * indistinguishable from the graph, so this is a decoder a reader aims at a
 * league they already know, not a detector. A roster-shape filter here would
 * reject the leagues the tool exists for.
 */
export function findPlaceholderDraft(
  drafts: SleeperDraft[],
): SleeperDraft | null {
  return drafts.find((draft) => settingNumber(draft, "slots_k") > 0) ?? null;
}

/**
 * Teams per round of the placeholder sequence. `settings.teams` is the slot
 * count; `draft_order` is only a fallback, because it maps *users who claimed a
 * slot* and is null before the commissioner sets an order — counting it
 * undercounts a draft with unassigned teams. The same trap `seasonDraftSlots`
 * in `manager/draft-picks.ts` documents when it reads a board's width.
 */
export function draftTeamCount(draft: SleeperDraft): number {
  const teams = settingNumber(draft, "teams");
  if (teams > 0) return teams;
  return Object.keys(draft.draft_order ?? {}).length;
}

/** "round.slot" for the zero-based `index`-th pick of a `teams`-wide draft. */
export function pickLabel(index: number, teams: number): string {
  const round = Math.floor(index / teams) + 1;
  const slot = (index % teams) + 1;
  return `${round}.${String(slot).padStart(2, "0")}`;
}

/**
 * The kicker picks of a draft, in the order they were made, labelled with the
 * rookie pick each one stands for. Sorted by `pick_no` before numbering — the
 * labels are positions in the sequence, so they are only right if the sequence
 * is.
 */
export function placeholderPicks(
  picks: SleeperDraftPick[],
  users: SleeperLeagueUser[],
  teams: number,
): PlaceholderPick[] {
  const byUserId = new Map(users.map((user) => [user.user_id, user]));

  return [...picks]
    .sort((a, b) => a.pick_no - b.pick_no)
    .filter((pick) => pick.metadata?.position === "K")
    .map((pick, index) => {
      const user = pick.picked_by ? byUserId.get(pick.picked_by) : undefined;
      return {
        pick: pickLabel(index, teams),
        player_id: pick.player_id,
        player_name: playerName(pick),
        picked_by: user
          ? {
              user_id: user.user_id,
              display_name: user.display_name,
              avatar: user.avatar,
            }
          : null,
      };
    });
}

const playerName = (pick: SleeperDraftPick): string => {
  const parts = [pick.metadata?.first_name, pick.metadata?.last_name].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  return parts.length > 0 ? parts.join(" ") : pick.player_id;
};

/**
 * The next placeholder up, or null once the draft is over — after the last
 * pick, `made` still names a valid-looking slot that will never exist, so the
 * gate is the draft's own status rather than arithmetic.
 */
export function nextPickLabel(
  draft: SleeperDraft,
  made: number,
  teams: number,
): string | null {
  if (draft.status === "complete") return null;
  return pickLabel(made, teams);
}
