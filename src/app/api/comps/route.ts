import { NextResponse } from "next/server";

import {
  compsField,
  compsWantedFields,
  fieldValue,
  getCompsPools,
  parseCompsDimensionKey,
  parseCompsFilters,
  resolveCompsFields,
  resolveSubjectPosition,
  resolveSubjectSeason,
  runCompsKnn,
  seasonLine,
  withCareerValues,
  withWindowValues,
} from "@/shared/comps";

import { readFailureResponse } from "../read-failure";

import type {
  ApiErrorPayload,
  CompsPayload,
  CompsSeasonRowPayload,
} from "@/shared/contract";
import type {
  CompsBasis,
  CompsFieldSpec,
  CompsPoolRow,
  CompsRefusal,
} from "@/shared/comps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The k nearest player-seasons to a subject, by weighted KNN over z-scored
 * fields.
 *
 *   GET /api/comps?player_id=4034
 *   GET /api/comps?player_id=4034&season=2024&basis=total
 *       &fields=rec,rec_yd,age&weights=100,80,50&k=5&min_games=6&positions=WR,TE
 *   GET /api/comps?player_id=4034&fields=rec_tgt,snap_pct
 *       &weights=100,80&windows=prev3,season
 *
 * Everything is optional but the player: the season defaults to the subject's
 * latest stored one, the fields to the subject position's catalogue defaults,
 * the window of every field to that season itself, and the candidate positions
 * to the subject's own. The route is a thin
 * composition — the grammar is `parseCompsFilters`, each decision is a pure
 * function in `shared/comps/resolve`, and the KNN itself is
 * `shared/comps/knn`, all tested where they live.
 *
 * No `getActiveSeason()` here: "today" enters this route only as the market
 * anchor's clamp, inside the pool read.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsed = parseCompsFilters(params);
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const filters = parsed.filters;

  try {
    // The career fields are corpus-relative (season N reads seasons < N), so
    // they are derived over the whole set here rather than stored on the
    // per-season cached pools — a deepening archive re-answers them without
    // waiting out anyone's TTL. The pass is memoized against the corpus's own
    // identity inside `withCareerValues`, so retuning a weight re-runs the KNN
    // and not the enrichment of every player-season on file.
    const pools = withCareerValues(await getCompsPools());

    const subjectSeasons = pools
      .filter((pool) =>
        pool.rows.some((row) => row.player_id === filters.player_id),
      )
      .map((pool) => pool.season);
    if (subjectSeasons.length === 0) {
      const error: ApiErrorPayload = {
        error: "No stored stats for this player.",
      };
      return NextResponse.json(error, { status: 404 });
    }

    const season = resolveSubjectSeason(filters.season, subjectSeasons);
    if (!season.ok) return refusalResponse(season);

    const subjectRow = (
      seasonPools: { season: string; rows: readonly CompsPoolRow[] }[],
    ) =>
      seasonPools
        .find((pool) => pool.season === season.season)!
        .rows.find((row) => row.player_id === filters.player_id)!;

    const position = resolveSubjectPosition(subjectRow(pools).position);
    if (!position.ok) return refusalResponse(position);

    // Which windows were asked for has to be known before the subject can be
    // asked whether it answers them, so the dimensions are materialized onto
    // every row first — one more pure pass, and none at all for a request that
    // named no window, which is every default board.
    const wanted = compsWantedFields(filters.fields, position.position);
    const windowed = withWindowValues(pools, wanted, filters.basis);
    const subject = subjectRow(windowed);

    const fields = resolveCompsFields({
      explicit: wanted,
      position: position.position,
      subject,
      basis: filters.basis,
    });
    if (!fields.ok) return refusalResponse(fields);

    const positions = filters.positions ?? [position.position];
    const knn = runCompsKnn({
      subject,
      candidates: windowed.flatMap((pool) => pool.rows),
      fields: fields.fields,
      basis: filters.basis,
      k: filters.k,
      minGames: filters.min_games,
      positions,
    });

    const payload: CompsPayload = {
      subject: rowPayload(subject, fields.fields, filters.basis),
      basis: filters.basis,
      fields: fields.fields.map((spec, i) => {
        const { field, window } = parseCompsDimensionKey(spec.key);
        const catalogue = compsField(field);
        return {
          key: spec.key,
          field,
          window,
          label: catalogue?.label ?? field,
          family: catalogue?.family ?? "production",
          weight: spec.weight,
          // The catalogue's flag, never the spec's: a windowed per-game field
          // resolves with `perGame: false` (it was divided by the window's own
          // games already) and is still a per-game number on screen.
          per_game: catalogue?.perGame ?? false,
          pool_mean: round(knn.fieldStats[i].mean),
          pool_stdev: round(knn.fieldStats[i].stdev),
        };
      }),
      dropped_fields: fields.dropped,
      positions,
      min_games: filters.min_games,
      seasons: pools.map((pool) => pool.season),
      candidates_considered: knn.candidatesConsidered,
      candidates_eligible: knn.candidatesEligible,
      excluded_missing: knn.excludedMissing,
      results: knn.results.map((result) => ({
        ...rowPayload(result.row, fields.fields, filters.basis),
        distance: Math.round(result.distance * 10000) / 10000,
        similarity: result.similarity,
      })),
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error("[comps] query failed:", error);
    return readFailureResponse(error, "Failed to compute comps");
  }
}

/**
 * A refusal onto its status: an unknown or unsupported *request* is a 400, a
 * season with nothing stored is a 404. The code leads the message so the two
 * comps-specific refusals stay distinguishable to a caller.
 */
function refusalResponse(refusal: CompsRefusal) {
  const error: ApiErrorPayload = {
    error: `${refusal.code}: ${refusal.error}`,
  };
  return NextResponse.json(error, {
    status: refusal.code === "COMPS_NO_SEASON" ? 404 : 400,
  });
}

/**
 * A pool row down to what the client draws: the weighted fields, each resolved
 * under the basis — byte-for-byte the numbers the distance used — and beside
 * them the whole season line, which is what "how did that season go" reads.
 */
function rowPayload(
  row: CompsPoolRow,
  fields: readonly CompsFieldSpec[],
  basis: CompsBasis,
): CompsSeasonRowPayload {
  const values: Record<string, number | null> = {};
  for (const field of fields) {
    values[field.key] = round(fieldValue(row, field, basis));
  }
  const line: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(seasonLine(row, basis))) {
    line[key] = round(value);
  }
  return {
    player_id: row.player_id,
    season: row.season,
    name: row.name,
    position: row.position,
    team: row.team,
    draft: row.draft,
    games: row.games,
    values,
    line,
  };
}

/** Two decimals — the precision the stats themselves are quoted at. */
function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
