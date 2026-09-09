/**
 * Why KeepTradeCut values are not on the page — the whole chain, read-only.
 *
 * **Every link in this chain degrades quietly into the next**, which is why a
 * diagnostic exists at all rather than a log grep. A scrape that fails leaves
 * the stored board exactly as it was; a board refused by `validateKtcBoard`
 * does the same and says so once, to a log nobody kept; a matcher that resolves
 * nothing writes a fully populated `ktc_values` whose every `sleeper_id` is
 * null, which every read in `shared/ktc` joins on — so the table looks perfect
 * and the page shows em dashes. And a process told `APP_PROCESS_ROLE=web` runs
 * none of it, correctly, with no error anywhere. Four different faults, one
 * symptom.
 *
 * So this walks the five stages in order and names the first one that is
 * broken:
 *
 *   1. the switches — would a process with this environment start the loop
 *   2. the stored board — rows, prices, ids and how old they are, per format
 *   3. the matcher's dependency — the Sleeper players map the ids come from
 *   4. the live scrape — fetch, parse and *judge* a board without writing it
 *   5. the read path — what `getKtcBoards` actually hands a card
 *
 * **It never writes.** No upsert, no reconcile, no timestamp, no advisory lock:
 * it is safe to point at production while the loop is running, which is the
 * whole point of it, and stage 4 deliberately re-runs the real validator over a
 * real scrape rather than a saved fixture — a KTC markup change is the failure
 * this is most often looking for, and only the live page can show one.
 *
 *   DATABASE_URL=postgres://…  npm run ktc:doctor
 *
 * `--offline` skips stage 4 where the network cannot reach KTC (a sandbox, a
 * locked-down CI box); everything else still answers, and the verdict says the
 * scrape went unchecked rather than passing it silently.
 */
import { pool } from "@/shared/db";
import { getMatchablePlayers } from "@/shared/players";
import {
  getKtcBoards,
  KTC_FORMATS,
  KTC_SYNC_VAR,
  KTC_TTL_MS,
  parseKtcPickName,
  resolveSleeperIds,
} from "@/shared/ktc";
import type { KtcFormat, KtcPlayer } from "@/shared/ktc";
import { fetchKtcRankings } from "@/shared/ktc/client";
import { validateKtcBoard } from "@/shared/ktc/validate";
import type { MatchablePlayer } from "@/shared/players";
import { errorMessage, loopSwitch, processRole, PROCESS_ROLE_VAR } from "@/shared/util";

const OFFLINE = process.argv.includes("--offline");

/** Findings, worst first — the verdict prints the first one that fired. */
const problems: string[] = [];
const note = (line: string) => problems.push(line);

const say = (line = "") => console.log(line);
const head = (n: number, title: string) => {
  say();
  say(`── ${n}. ${title} ${"─".repeat(Math.max(0, 58 - title.length))}`);
};

const ago = (at: Date | null): string => {
  if (!at) return "never";
  const ms = Date.now() - at.getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 90) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
};

const pct = (part: number, whole: number): string =>
  whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`;

/* ── 1. Would this environment run the loop at all ──────────────────────── */

function stageSwitches(): void {
  head(1, "Switches");
  const role = processRole();
  const ktc = loopSwitch(KTC_SYNC_VAR);
  const players = loopSwitch("PLAYERS_SYNC");

  say(`  ${PROCESS_ROLE_VAR}=${process.env[PROCESS_ROLE_VAR] ?? "(unset)"} → role "${role}"`);
  say(`  ${KTC_SYNC_VAR}=${process.env[KTC_SYNC_VAR] ?? "(unset)"} → ${ktc.enabled ? "enabled" : "DISABLED"}`);
  say(`  PLAYERS_SYNC=${process.env.PLAYERS_SYNC ?? "(unset)"} → ${players.enabled ? "enabled" : "DISABLED"}`);

  // Read from *this* shell, which is a worker one-off rather than the web dyno
  // — so this stage reports what the config vars say, and only a `web` role is
  // conclusive: that value reaches every dyno, and the Procfile's worker line
  // is the one thing that overrides it.
  if (role === "web") {
    note(
      `${PROCESS_ROLE_VAR}=web is set, so the web dyno starts no loops. That is ` +
        `correct only if a worker dyno is running: check \`heroku ps\` — if ` +
        `worker is at 0, nothing is refreshing KTC. Either scale it up or unset ` +
        `the config var to put the loops back on the web dyno.`,
    );
  }
  if (!ktc.enabled) note(`${KTC_SYNC_VAR}=off — the KTC loop is switched off.`);
  if (!players.enabled) {
    note(
      `PLAYERS_SYNC=off — the Sleeper players map is not refreshing, which is ` +
        `what the matcher resolves sleeper_id against (stage 3).`,
    );
  }
}

/* ── 2. What is actually stored ─────────────────────────────────────────── */

type BoardRow = {
  format: KtcFormat;
  rows: number;
  priced: number;
  identified: number;
  pricedIdentified: number;
  picks: number;
  updated_at: Date | null;
};

async function stageStored(): Promise<BoardRow[]> {
  head(2, "Stored board (ktc_values)");
  const { rows } = await pool.query<{
    format: KtcFormat;
    rows: string;
    priced: string;
    identified: string;
    priced_identified: string;
    picks: string;
    updated_at: Date | null;
  }>(
    `SELECT format,
            count(*)::text AS rows,
            count(*) FILTER (
              WHERE sf_value IS NOT NULL OR oneqb_value IS NOT NULL)::text AS priced,
            count(*) FILTER (WHERE sleeper_id IS NOT NULL)::text AS identified,
            count(*) FILTER (
              WHERE sleeper_id IS NOT NULL
                AND (sf_value IS NOT NULL OR oneqb_value IS NOT NULL))::text
              AS priced_identified,
            count(*) FILTER (WHERE position = 'RDP')::text AS picks,
            max(updated_at) AS updated_at
       FROM ktc_values
      GROUP BY format`,
  );

  const byFormat = new Map(rows.map((r) => [r.format, r]));
  const out: BoardRow[] = [];

  for (const format of KTC_FORMATS) {
    const r = byFormat.get(format);
    const board: BoardRow = {
      format,
      rows: Number(r?.rows ?? 0),
      priced: Number(r?.priced ?? 0),
      identified: Number(r?.identified ?? 0),
      pricedIdentified: Number(r?.priced_identified ?? 0),
      picks: Number(r?.picks ?? 0),
      updated_at: r?.updated_at ?? null,
    };
    out.push(board);

    const stale =
      board.updated_at === null ||
      Date.now() - board.updated_at.getTime() > KTC_TTL_MS;
    say(
      `  ${format.padEnd(8)} rows=${board.rows}  priced=${board.priced}  ` +
        `sleeper_id=${board.identified} (${pct(board.identified, board.rows)})  ` +
        `picks=${board.picks}  scraped ${ago(board.updated_at)}` +
        `${stale ? "  ← STALE" : ""}`,
    );

    if (board.rows === 0) {
      note(
        `The ${format} board has no rows at all. Nothing has ever written it — ` +
          `the loop is not running (stage 1) or every scrape has failed (stage 4).`,
      );
      continue;
    }
    if (board.priced === 0) {
      note(
        `All ${board.rows} ${format} rows have null values. That is the ` +
          `reconcile statement having nulled the board, which only happens ` +
          `when a scrape came back short enough to pass validation but miss ` +
          `everyone — check stage 4.`,
      );
    }
    if (board.identified === 0) {
      note(
        `Not one ${format} row carries a sleeper_id, so every read in ` +
          `shared/ktc — which all join on it — finds nothing. The board is ` +
          `stored and unreachable. See stage 3: this is what an empty or ` +
          `unreadable players map does, and it is silent.`,
      );
    } else if (board.identified < board.rows * 0.5) {
      note(
        `Only ${pct(board.identified, board.rows)} of ${format} rows carry a ` +
          `sleeper_id (${board.identified}/${board.rows}). A healthy run resolves ` +
          `~94% of dynasty skill players; a rate this low means the players map ` +
          `is thin or stale (stage 3).`,
      );
    }
    if (stale) {
      note(
        `The ${format} board was last written ${ago(board.updated_at)}, past its ` +
          `${Math.round(KTC_TTL_MS / 60_000)}-minute TTL. The loop is not ticking ` +
          `or every tick is failing — stages 1 and 4.`,
      );
    }
    if (format === "dynasty" && board.picks === 0 && board.rows > 0) {
      note(
        `The dynasty board carries no RDP (rookie pick) rows, so ktc_picks is ` +
          `zero for every roster. KTC normally prices three seasons of four ` +
          `rounds — around 36 rows.`,
      );
    }
  }
  return out;
}

/* ── 3. The map the ids come from ───────────────────────────────────────── */

async function stagePlayers(): Promise<MatchablePlayer[]> {
  head(3, "Sleeper players map (the matcher's dependency)");
  const { rows: counts } = await pool.query<{ total: string; updated_at: Date | null }>(
    `SELECT count(*)::text AS total, max(updated_at) AS updated_at FROM players`,
  );
  const total = Number(counts[0].total);
  const matchable = await getMatchablePlayers();

  say(
    `  players=${total}  matchable=${matchable.length}  ` +
      `refreshed ${ago(counts[0].updated_at)}`,
  );

  if (total === 0) {
    note(
      `The players table is empty. The matcher resolves every sleeper_id ` +
        `against it, so a KTC sync that runs now stores the board and clears ` +
        `every id — which reads on the page as no values at all. Run the ` +
        `players sync first (it is the loop staggered ahead of KTC for exactly ` +
        `this reason).`,
    );
  } else if (matchable.length < total * 0.5) {
    note(
      `Only ${matchable.length} of ${total} player rows are matchable (they need ` +
        `a non-null position). The map may have been written from a truncated ` +
        `Sleeper response.`,
    );
  }
  return matchable;
}

/* ── 4. The live page, judged but not written ───────────────────────────── */

async function stageScrape(stored: BoardRow[], matchable: MatchablePlayer[]): Promise<void> {
  head(4, "Live scrape (read-only — nothing is written)");
  if (OFFLINE) {
    say("  skipped (--offline)");
    note(
      `The live scrape was skipped, so a KTC markup change — the commonest ` +
        `cause of this, and invisible from the database alone — has not been ` +
        `ruled out. Re-run without --offline from somewhere that can reach ` +
        `keeptradecut.com.`,
    );
    return;
  }

  for (const format of KTC_FORMATS) {
    const previous = stored.find((b) => b.format === format)?.priced ?? 0;
    let scraped: KtcPlayer[];
    try {
      scraped = await fetchKtcRankings(format);
    } catch (error) {
      say(`  ${format.padEnd(8)} FETCH/PARSE FAILED: ${errorMessage(error)}`);
      note(
        `The ${format} board could not be fetched or parsed: ` +
          `${errorMessage(error)}. If the message names \`playersArray\`, KTC ` +
          `changed its markup and shared/ktc/parse.ts needs updating; a 403 is ` +
          `KTC blocking the scraper.`,
      );
      continue;
    }

    // The real validator, against the real stored count — so a refusal shows
    // up here as the reason the board has not moved, rather than as a log line
    // fifteen minutes ago.
    const verdict = validateKtcBoard(format, scraped, previous);
    const resolved = resolveSleeperIds(
      verdict.ok ? verdict.players : scraped,
      matchable,
    );
    const players = verdict.ok ? verdict.players : scraped;
    const nonPick = players.filter((p) => p.position !== "RDP");
    const picks = players.filter((p) => p.position === "RDP");
    const named = picks.filter((p) => parseKtcPickName(p.playerName ?? ""));

    say(
      `  ${format.padEnd(8)} scraped=${scraped.length}  ` +
        `valid=${verdict.ok ? verdict.players.length : verdict.valid}  ` +
        `picks=${picks.length} (parsed ${named.length})  ` +
        `would-match=${resolved.size}/${nonPick.length} ` +
        `(${pct(resolved.size, nonPick.length)})  ` +
        `${verdict.ok ? "ACCEPTED" : `REFUSED: ${verdict.reason}`}`,
    );

    if (!verdict.ok) {
      note(
        `A live ${format} scrape is REFUSED by validateKtcBoard: ` +
          `${verdict.reason}. The sync is running and deliberately writing ` +
          `nothing, which is why the stored board is frozen rather than wrong.`,
      );
      continue;
    }
    if (resolved.size === 0 && nonPick.length > 0) {
      note(
        `A live ${format} scrape parses and validates, but not one of its ` +
          `${nonPick.length} players matches the stored Sleeper map. The sync ` +
          `would store the board and write null for every sleeper_id — see ` +
          `stage 3.`,
      );
    } else if (resolved.size < nonPick.length * 0.8) {
      note(
        `A live ${format} scrape matches only ${pct(resolved.size, nonPick.length)} ` +
          `of its players to Sleeper ids. Expect ~94%: a drop this size is ` +
          `usually a stale players map or a KTC position rename ` +
          `(shared/ktc/match.ts's KTC_POSITIONS).`,
      );
    }
    if (picks.length > 0 && named.length === 0) {
      note(
        `None of the ${picks.length} ${format} pick rows parse. KTC has renamed ` +
          `them and shared/ktc/picks.ts needs updating — every pick on every ` +
          `card is unpriced until it is. Example: "${picks[0].playerName}".`,
      );
    }
  }
}

/* ── 5. What a card actually gets ───────────────────────────────────────── */

async function stageRead(stored: BoardRow[]): Promise<void> {
  head(5, "Read path (getKtcBoards — what a card is handed)");
  for (const format of KTC_FORMATS) {
    try {
      const boards = await getKtcBoards(format);
      const values = Object.keys(boards.values).length;
      const picks = Object.keys(boards.picks).length;
      const storedPicks = stored.find((b) => b.format === format)?.picks ?? 0;
      say(
        `  ${format.padEnd(8)} priced players=${values}  priced picks=${picks}  ` +
          `updated_at=${boards.updated_at ?? "null"}`,
      );
      if (values === 0) {
        note(
          `getKtcBoards("${format}") hands a card an empty player board, which ` +
            `is exactly the em dashes on screen. Whichever stage above fired ` +
            `first is the cause.`,
        );
      }
      // Stored pick rows that reach the read and come back understood by
      // nothing is what a KTC rename looks like from the database alone —
      // catchable here without the network, where stage 4 needs the live page.
      if (storedPicks > 0 && picks === 0) {
        note(
          `${storedPicks} ${format} pick row(s) are stored and none of them ` +
            `parse, so ktc_picks is zero on every card. KTC has renamed its ` +
            `picks and shared/ktc/picks.ts needs updating — the player values ` +
            `are unaffected.`,
        );
      }
    } catch (error) {
      say(`  ${format.padEnd(8)} READ FAILED: ${errorMessage(error)}`);
      note(`Reading the ${format} board failed: ${errorMessage(error)}`);
    }
  }
}

/* ── Verdict ────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  say("KeepTradeCut values — diagnosis (read-only)");
  stageSwitches();
  const stored = await stageStored();
  const matchable = await stagePlayers();
  await stageScrape(stored, matchable);
  await stageRead(stored);

  head(6, "Verdict");
  if (problems.length === 0) {
    say("  Nothing wrong found in the sync chain: both boards are stored,");
    say("  fresh, identified and readable. If the page still shows em dashes,");
    say("  the fault is downstream of this — check the card's column settings");
    say("  (a KTC column forced onto the redraft market carries no picks) and");
    say("  the league's own resolved market.");
  } else {
    for (const [i, line] of problems.entries()) say(`  ${i + 1}. ${line}\n`);
  }
  say();
}

main()
  .catch((error) => {
    console.error("\n[ktc-doctor] failed:", errorMessage(error));
    process.exitCode = 1;
  })
  .finally(() => pool.end());
