import type { UserInfo } from "./user-info";

/**
 * The manager's own record in a league, off their roster's stored settings.
 *
 * Null on {@link ManagerLeague} rather than zeroed: a league whose rosters have
 * not been fetched, and a league in which the manager has genuinely played no
 * games, are different answers, and `0-0` is only honest about the second.
 */
export type LeagueRecord = { wins: number; losses: number; ties: number };

/**
 * A manager's league, as read from Postgres and sent on the leagues stream.
 *
 * `avatar_url` is a full URL rather than Sleeper's avatar id, built server-side
 * by `sleeperAvatarUrl`, so a `"use client"` module never imports
 * `shared/sleeper` to render one.
 *
 * **The last three are Sleeper's own blobs, sent whole, and that is the league
 * filters' doing** — this type was trimmed to what the card renders until
 * `features/shared/league-filters` needed them. Whole rather than reduced to
 * derived booleans, because the Settings and Scoring menus are built from the
 * keys *the leagues in hand actually carry*: what a league pays for and how it
 * is configured are house rules, and a fixed list of flags would offer keys
 * nobody sets while hiding the one someone wants to filter on. The cost is
 * ~2.2KB a league — Sleeper writes out its whole scoring template — and it is
 * paid twice on a refresh stream, since the cached result and the post-sync one
 * both carry the list.
 */
export type ManagerLeague = {
  league_id: string;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  avatar_url: string | null;
  /** The manager's team name in this league, where they have set one. */
  team_name: string | null;
  record: LeagueRecord | null;
  /**
   * The league's lineup slots, `["QB","RB",…,"BN"]`.
   *
   * **Null and `[]` are different answers and readers must keep them apart.** A
   * league whose graph has not been fetched has no lineup on file, where an
   * empty array would be a league that starts nobody — which is why `slotCount`
   * answers null and a slot rule *fails* rather than passing on an assumed zero.
   */
  roster_positions: string[] | null;
  /**
   * Sleeper's league settings blob — `type`, `best_ball`, `taxi_slots`,
   * `trade_deadline` and ~45 more. Loosely typed because it is: the values are
   * mostly numbers, and a reader that needs one guards for it.
   */
  settings: Record<string, unknown> | null;
  /** What the league pays per stat — `rec`, `pass_td`, `bonus_rec_te`, … */
  scoring_settings: Record<string, number> | null;
};

/** Incremental sync progress, reported after each league finishes. */
export type SyncProgress = { loaded: number; total: number; failed: number };

/** Child rows persisted across a set of league graphs. */
export type LeagueCounts = {
  rosters: number;
  leagueUsers: number;
  tradedPicks: number;
  drafts: number;
  draftPicks: number;
  transactions: number;
  /** Roster-weeks of scoring persisted (one row per roster per week). */
  matchups: number;
};

export type SyncSummary = LeagueCounts & {
  season: string;
  /**
   * true when another caller held this manager's lock for longer than the wait
   * allows, so this run did nothing and someone else is *still writing*.
   *
   * **It is what separates the two skips, which mean opposite things.** A skip
   * because the data was already fresh (or because the lock's winner finished
   * while we queued) leaves a complete, current league graph — that is what the
   * blocking lock is *for*. A skip because the wait ran out leaves whatever the
   * holder has committed so far, which for a manager being synced the first
   * time is a fraction of their leagues. Both would otherwise report
   * `skipped: true` and nothing else, so a caller could not tell "nothing to
   * do" from "read this again shortly".
   */
  locked: boolean;
  /** true when the sync did no work — see {@link SyncSummary.locked} for why. */
  skipped: boolean;
  /** total leagues the manager belongs to this season. */
  total: number;
  /** leagues successfully fetched and persisted, partial ones included. */
  leagues: number;
  /**
   * Of those, how many were written from an **incomplete** upstream answer.
   * They keep their stored rows and stay due; what they must never do is count
   * toward a completed sync.
   */
  partial: number;
  /** leagues that failed to sync (e.g. Sleeper timeout) and were skipped. */
  failed: number;
  /**
   * Whether the manager's whole league graph is now known-current.
   *
   * **The one field a caller may treat as "this list is final".** It is not
   * `failed === 0`: a run that did nothing because it lost the lock, or because
   * the last attempt is still inside its throttle window, has no failures to
   * report and no claim to make either. It is true for a real run that dropped
   * no league, and for a skip that was skipped *because a complete sync is
   * still fresh* — and false everywhere else, which is the whole of the
   * distinction `synced_at` and `attempt_at` are two columns for.
   *
   * **It is not `failed === 0` in the other direction either.** A league whose
   * graph committed from a partial fetch reports no failure at all, so counting
   * only failures would call such a run complete and stamp `synced_at` over
   * data nobody had managed to read.
   */
  complete: boolean;
};

export type LeaguesResultMessage = {
  type: "result";
  user: UserInfo;
  season: string;
  leagues: ManagerLeague[];
  /**
   * true when the leagues sent are **not known-current** — cached past their
   * TTL, or left short by a sync that failed, lost the lock or was throttled.
   * It is the negation of {@link SyncSummary.complete} on the post-refresh
   * message, and never merely "a refresh is running".
   */
  stale: boolean;
  /** true when a refresh is running and a second `result` will follow. */
  refreshing: boolean;
  /** Present only on the post-refresh message. */
  summary?: SyncSummary;
};

/** Per-league sync progress, so a 100+ league account can show a bar. */
export type LeaguesProgressMessage = SyncProgress & {
  type: "progress";
  /** `initial` is a cold foreground sync; `refresh` runs behind sent cache. */
  phase: "initial" | "refresh";
};

export type LeaguesErrorMessage = { type: "error"; error: string };

/**
 * One line of `GET /api/user/[username]/leagues`, which answers newline-
 * delimited JSON rather than one object: cached leagues go out immediately and
 * a refresh's progress follows on the same response.
 */
export type LeaguesStreamMessage =
  | LeaguesResultMessage
  | LeaguesProgressMessage
  | LeaguesErrorMessage;
