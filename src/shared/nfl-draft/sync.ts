import {
  bulkInsert,
  countRows,
  isFresh,
  LOCK_KEYS,
  withAdvisoryLock,
  withTransaction,
} from "@/shared/db";

import { fetchNflDraftPicks } from "./client";
import { countNflDraftPicks } from "./queries";
import { validateNflDraftPicks } from "./validate";

import type { NflDraftPick } from "./types";

/**
 * How long a stored crosswalk stays fresh.
 *
 * Twelve hours for data that moves once a year, which sounds generous and is
 * the right shape: the file is only interesting on the two days a year it
 * changes a lot (the draft, and the undrafted signings just after it), and a
 * gate this size means the new class lands the same day rather than the same
 * week. It costs two 2.6MB fetches a day of a static GitHub file.
 */
export const NFL_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export type NflDraftSyncSummary = {
  /** true when another instance held the lock and this run did nothing. */
  locked: boolean;
  /** true when nothing was fetched — locked out, fresh, or refused. */
  skipped: boolean;
  /** Rows stored after the run. */
  count: number;
  /** Of `count`, how many were actually drafted; the rest went undrafted. */
  drafted: number;
  /** Rows deleted because the crosswalk no longer names them. */
  removed: number;
  /** Why a response was refused, or null when it wasn't. */
  rejected: string | null;
};

const COLUMNS = [
  "player_id",
  "draft_season",
  "draft_round",
  "draft_slot",
  "draft_overall",
];

const ON_CONFLICT = `(player_id) DO UPDATE SET
    draft_season = EXCLUDED.draft_season,
    draft_round = EXCLUDED.draft_round,
    draft_slot = EXCLUDED.draft_slot,
    draft_overall = EXCLUDED.draft_overall,
    updated_at = now()`;

/**
 * Fetch the NFL draft crosswalk and replace `nfl_draft_picks` with it.
 *
 * Upsert-then-delete-what's-missing inside one transaction — the rule a slice
 * that can shrink follows everywhere in this app, because an upsert alone
 * leaves rows that quietly look current. The delete is guarded by the
 * validation above rather than by a bare `length > 0`: this table's whole
 * population arrives in one response, so "the response was short" and "players
 * left the league" are indistinguishable by count alone, and only the validator
 * knows the difference.
 *
 * Held under an advisory lock so extra instances sharing one database don't
 * fetch concurrently, with the freshness gate *inside* it — otherwise every
 * instance decides for itself that a refresh is due and they queue up to do it
 * in turn.
 */
export async function syncNflDraftPicks(
  options: { force?: boolean } = {},
): Promise<NflDraftSyncSummary> {
  const summary = await withAdvisoryLock(LOCK_KEYS.nflDraft, async () => {
    if (!options.force && (await isFresh("nfl_draft_picks", NFL_DRAFT_TTL_MS))) {
      return {
        locked: false,
        skipped: true,
        count: await countRows("nfl_draft_picks"),
        drafted: 0,
        removed: 0,
        rejected: null,
      };
    }

    const parsed = await fetchNflDraftPicks();
    const previous = await countNflDraftPicks();
    const validation = validateNflDraftPicks(parsed.picks, previous);

    if (!validation.ok) {
      console.error(
        `[nfl-draft] Refused a suspicious crosswalk: ${validation.reason} ` +
          `(previous=${validation.previous} valid=${validation.valid} ` +
          `drafted=${validation.drafted}). Stored picks left untouched.`,
      );
      return {
        locked: false,
        skipped: true,
        count: previous,
        drafted: 0,
        removed: 0,
        rejected: validation.reason,
      };
    }

    const picks = validation.picks;

    // Worth a line when it happens: the two counts that aren't simply "how many
    // rows" are the ones that say the *source* changed shape rather than the
    // league having a draft. A handful of conflicting duplicates is normal (the
    // crosswalk resolves a few ids onto two same-named players); a jump in them
    // is a resolution regression upstream.
    const { conflicting_duplicate: conflicts, class_pending: pending } =
      parsed.rejected;
    if (conflicts > 0 || pending > 0) {
      console.log(
        `[nfl-draft] Held back ${conflicts} row(s) with conflicting draft ` +
          `positions and ${pending} awaiting an undrafted class ` +
          `(newest held class: ${parsed.newestSettledSeason ?? "none"}).`,
      );
    }

    const removed = await withTransaction(async (client) => {
      await bulkInsert(client, {
        table: "nfl_draft_picks",
        columns: COLUMNS,
        rows: picks,
        values: (pick: NflDraftPick) => [
          pick.playerId,
          pick.season,
          pick.round,
          pick.slot,
          pick.overall,
        ],
        trailing: { column: "updated_at", sql: "now()" },
        onConflict: ON_CONFLICT,
      });

      const { rowCount } = await client.query(
        `DELETE FROM nfl_draft_picks WHERE player_id <> ALL($1::varchar[])`,
        [picks.map((pick) => pick.playerId)],
      );
      return rowCount ?? 0;
    });

    return {
      locked: false,
      skipped: false,
      count: picks.length,
      drafted: validation.drafted,
      removed,
      rejected: null,
    };
  });

  return (
    summary ?? {
      locked: true,
      skipped: true,
      count: 0,
      drafted: 0,
      removed: 0,
      rejected: null,
    }
  );
}
