import { NextResponse } from "next/server";

import {
  compsField,
  fieldValue,
  getCompsPools,
  parseCompsFilters,
  resolveCompsFields,
  resolveSubjectPosition,
  resolveSubjectSeason,
  runCompsKnn,
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
 *
 * Everything is optional but the player: the season defaults to the subject's
 * latest stored one, the fields to the subject position's catalogue defaults,
 * and the candidate positions to the subject's own. The route is a thin
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
    const pools = await getCompsPools();

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

    const subject = pools
      .find((pool) => pool.season === season.season)!
      .rows.find((row) => row.player_id === filters.player_id)!;

    const position = resolveSubjectPosition(subject.position);
    if (!position.ok) return refusalResponse(position);

    const fields = resolveCompsFields({
      explicit: filters.fields,
      position: position.position,
      subject,
      basis: filters.basis,
    });
    if (!fields.ok) return refusalResponse(fields);

    const positions = filters.positions ?? [position.position];
    const knn = runCompsKnn({
      subject,
      candidates: pools.flatMap((pool) => pool.rows),
      fields: fields.fields,
      basis: filters.basis,
      k: filters.k,
      minGames: filters.min_games,
      positions,
    });

    const payload: CompsPayload = {
      subject: rowPayload(subject, fields.fields, filters.basis),
      basis: filters.basis,
      fields: fields.fields.map((field, i) => ({
        key: field.key,
        label: compsField(field.key)?.label ?? field.key,
        family: compsField(field.key)?.family ?? "production",
        weight: field.weight,
        per_game: field.perGame,
        pool_mean: round(knn.fieldStats[i].mean),
        pool_stdev: round(knn.fieldStats[i].stdev),
      })),
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
 * A pool row down to what the client draws: the weighted fields only, each
 * resolved under the basis — byte-for-byte the numbers the distance used.
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
  return {
    player_id: row.player_id,
    season: row.season,
    name: row.name,
    position: row.position,
    team: row.team,
    games: row.games,
    values,
  };
}

/** Two decimals — the precision the stats themselves are quoted at. */
function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}
