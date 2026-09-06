import { runMigrations } from "@/shared/db";
import {
  EARLIEST_SEASON,
  isCompsScoring,
  loadCompsCorpus,
} from "@/shared/player-seasons";
import type { CompsScoring } from "@/shared/player-seasons";

/**
 * `npm run comps:load-corpus` — load historical player-seasons into
 * `player_seasons`, the corpus `/comps` ranks against.
 *
 * ```
 * npm run comps:load-corpus                        # 2018 → the latest complete season
 * npm run comps:load-corpus -- --from 2015
 * npm run comps:load-corpus -- --from 2024 --to 2024
 * npm run comps:load-corpus -- --scoring ppr
 * npm run comps:load-corpus -- --positions WR,TE
 * ```
 *
 * **No season is chosen by editing source.** The span is arguments with
 * documented defaults, and the loader refuses — by name, on the console — any
 * season the NFL has not finished.
 *
 * It needs `DATABASE_URL` (the npm script passes `--env-file=.env`, so a
 * checkout's own `.env` is enough) and outbound access to Sleeper and to
 * GitHub, where the draft-capital crosswalk is published (see
 * `loader/draft-source`). It reads the stored **players map** for the identity
 * and the dated fields behind age and
 * experience, so `npm run dev` should have run at least once
 * — or the players sync should have — before this does; a load against an
 * empty map skips every row and says so rather than writing anything.
 *
 * Migrations are applied first, for the same reason `src/instrumentation.ts`
 * applies them on boot: a loader must not write against a schema it cannot
 * vouch for, and `comps_corpus_meta` arrived with this.
 */

type Args = {
  from: number | null;
  to: number | null;
  scoring: CompsScoring | null;
  positions: string[] | null;
  help: boolean;
};

function parseArgs(argv: readonly string[]): Args | { error: string } {
  const args: Args = { from: null, to: null, scoring: null, positions: null, help: false };

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help" || flag === "-h") {
      args.help = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) return { error: `${flag} needs a value` };

    switch (flag) {
      case "--from":
      case "--to": {
        if (!/^\d{4}$/.test(value)) return { error: `${flag} must be a four-digit season` };
        args[flag === "--from" ? "from" : "to"] = Number(value);
        break;
      }
      case "--scoring": {
        if (!isCompsScoring(value)) {
          return { error: `--scoring must be half_ppr, ppr or std` };
        }
        args.scoring = value;
        break;
      }
      case "--positions": {
        const list = value
          .split(",")
          .map((p) => p.trim().toUpperCase())
          .filter(Boolean);
        if (list.length === 0) return { error: "--positions needs at least one position" };
        args.positions = list;
        break;
      }
      default:
        return { error: `unknown option ${flag}` };
    }
  }

  if (args.from !== null && args.to !== null && args.from > args.to) {
    return { error: "--from must not be after --to" };
  }
  return args;
}

const USAGE = `Load the comps corpus into player_seasons.

  npm run comps:load-corpus -- [options]

  --from <season>       earliest season to load (default ${EARLIEST_SEASON})
  --to <season>         latest season to load (default: the latest complete one)
  --scoring <basis>     half_ppr (default) | ppr | std
  --positions <list>    comma-separated, e.g. WR,TE (default: QB,RB,WR,TE)
  --help
`;

async function main(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2));
  if ("error" in parsed) {
    console.error(`[comps:load] ${parsed.error}\n\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }

  console.log("[comps:load] applying migrations…");
  await runMigrations();

  const started = Date.now();
  const report = await loadCompsCorpus({
    from: parsed.from,
    to: parsed.to,
    scoring: parsed.scoring ?? undefined,
    positions: parsed.positions ?? undefined,
    onProgress: (line) => console.log(`[comps:load] ${line}`),
  });

  if (report.locked) {
    console.error("[comps:load] another load is already running; nothing was written.");
    return 1;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (report.meta === null) {
    console.error(
      `[comps:load] wrote nothing in ${seconds}s. ` +
        (report.plan.seasons.length === 0
          ? "No season was eligible — see the refusals above."
          : "Every season failed — see the errors above."),
    );
    for (const error of report.errors) {
      console.error(`[comps:load]   ${error.season}: ${error.message}`);
    }
    return 1;
  }

  const { meta } = report;
  console.log(
    `[comps:load] wrote ${report.inserted} new and ${report.updated} updated rows ` +
      `over ${meta.seasons.length} season(s) in ${seconds}s`,
  );
  console.log(`[comps:load]   seasons     ${meta.seasons.join(", ")}`);
  console.log(`[comps:load]   scoring     ${meta.scoring}`);
  console.log(`[comps:load]   source      ${meta.source}`);
  console.log(`[comps:load]   loader      v${meta.loader_version}`);
  console.log(`[comps:load]   complete to ${meta.max_completed_season}`);
  console.log(`[comps:load]   corpus      ${meta.rows} rows, ${meta.players} players`);
  console.log(
    `[comps:load]   experience  ${report.experience.rookie_year} from rookie_year, ` +
      `${report.experience.years_exp} derived from years_exp`,
  );
  // Named rather than left to be discovered: a run where `unknown` dominates
  // is a crosswalk that has stopped matching, not a class of undrafted
  // players — see `loader/draft-source`.
  console.log(
    `[comps:load]   draft       ${report.draft.drafted} drafted, ` +
      `${report.draft.undrafted} undrafted, ${report.draft.unknown} unknown`,
  );

  const skips = Object.entries(report.skipped).sort((a, b) => b[1] - a[1]);
  if (skips.length > 0) {
    console.log("[comps:load]   skipped:");
    for (const [reason, count] of skips) {
      console.log(`[comps:load]     ${count} — ${reason}`);
    }
  }
  for (const error of report.errors) {
    console.error(`[comps:load]   FAILED ${error.season}: ${error.message}`);
  }

  return report.errors.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("[comps:load] failed:", error);
    process.exit(1);
  });
