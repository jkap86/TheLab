import { integer, isSeason } from "../query/parse.ts";

import { compsField, isCompsPosition } from "./fields.ts";

import type { CompsPosition } from "./fields.ts";

/**
 * `/api/comps`'s query string, validated and nothing else — the
 * `manager/adp-filters` shape: the route's SQL-free logic only ever sees checked
 * values, and this module is pure so the grammar is tested under Node's runner.
 */

/** Which number a production field contributes: a per-game average or the season total. */
export type CompsBasis = "per_game" | "total";

/** One weighted field, as the caller asked for it. Weight is always positive here. */
export type CompsWeightedField = { key: string; weight: number };

export type CompsFilters = {
  player_id: string;
  /** Explicit season, or null meaning the subject's latest stored season. */
  season: string | null;
  basis: CompsBasis;
  /** Explicit fields with positive weights, or null meaning position defaults. */
  fields: CompsWeightedField[] | null;
  k: number;
  min_games: number;
  /** Candidate positions, or null meaning the subject's own. */
  positions: CompsPosition[] | null;
};

export const COMPS_K_DEFAULT = 10;
export const COMPS_K_MAX = 50;
export const COMPS_MIN_GAMES_DEFAULT = 4;

/**
 * What a player id may look like before it reaches a query as a bound
 * parameter. Sleeper's player ids are digit strings and its team defences are
 * team codes; this is a little wider so neither shape is a 400, and bounded so
 * a request line cannot carry a novel.
 */
const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `fields=` and `weights=` are parallel lists, which is why this module does
 * **not** read them through the shared `list()` primitive: that one
 * deduplicates, so `weights=100,50,100` would silently arrive as two items and
 * desync from its three fields. This split preserves order and repetition, and
 * duplicate *fields* are then rejected by name — an error, never a silent
 * collapse.
 */
function rawList(params: URLSearchParams, key: string): string[] {
  return params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function parseCompsFilters(
  params: URLSearchParams,
): { ok: true; filters: CompsFilters } | { ok: false; error: string } {
  const player_id = params.get("player_id")?.trim() ?? "";
  if (!player_id) {
    return { ok: false, error: "Missing player_id." };
  }
  if (!PLAYER_ID_PATTERN.test(player_id)) {
    return { ok: false, error: `Invalid player_id: ${player_id}.` };
  }

  const rawSeason = params.get("season")?.trim();
  if (rawSeason && !isSeason(rawSeason)) {
    return {
      ok: false,
      error: `Invalid season: ${rawSeason}. Expected a 4-digit year.`,
    };
  }
  const season = rawSeason || null;

  const rawBasis = params.get("basis")?.trim();
  if (rawBasis && rawBasis !== "per_game" && rawBasis !== "total") {
    return {
      ok: false,
      error: `Invalid basis: ${rawBasis}. Expected per_game or total.`,
    };
  }
  const basis: CompsBasis = rawBasis === "total" ? "total" : "per_game";

  const fields = parseFields(params);
  if (!fields.ok) return fields;

  const k = integer(params, "k", {
    min: 1,
    max: COMPS_K_MAX,
    fallback: COMPS_K_DEFAULT,
  });
  if (!k.ok) return k;

  const minGames = integer(params, "min_games", {
    min: 1,
    max: 18,
    fallback: COMPS_MIN_GAMES_DEFAULT,
  });
  if (!minGames.ok) return minGames;

  const positions = parsePositions(params);
  if (!positions.ok) return positions;

  return {
    ok: true,
    filters: {
      player_id,
      season,
      basis,
      fields: fields.value,
      k: k.value ?? COMPS_K_DEFAULT,
      min_games: minGames.value ?? COMPS_MIN_GAMES_DEFAULT,
      positions: positions.value,
    },
  };
}

function parseFields(
  params: URLSearchParams,
):
  | { ok: true; value: CompsWeightedField[] | null }
  | { ok: false; error: string } {
  const keys = rawList(params, "fields");
  const weights = rawList(params, "weights");

  if (keys.length === 0) {
    if (weights.length > 0) {
      return { ok: false, error: "weights= without fields= names nothing." };
    }
    return { ok: true, value: null };
  }

  const unknown = keys.filter((key) => compsField(key) === undefined);
  if (unknown.length > 0) {
    return { ok: false, error: `Unknown fields: ${unknown.join(", ")}.` };
  }

  const seen = new Set<string>();
  for (const key of keys) {
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate field: ${key}.` };
    }
    seen.add(key);
  }

  // Absent weights read as "these fields, equally" rather than as a length
  // mismatch of zero — a caller naming fields has said what to compare on, and
  // demanding a redundant weights list would make the simplest curl a 400.
  const parsedWeights =
    weights.length === 0 ? keys.map(() => 100) : weights.map(Number);

  if (parsedWeights.length !== keys.length) {
    return {
      ok: false,
      error: `fields= names ${keys.length} fields but weights= carries ${parsedWeights.length}.`,
    };
  }

  for (const [i, weight] of parsedWeights.entries()) {
    if (!Number.isInteger(weight) || weight < 0 || weight > 100) {
      return {
        ok: false,
        error: `Invalid weight for ${keys[i]}: ${weights[i]}. Expected an integer 0-100.`,
      };
    }
  }

  // A zero weight is the caller switching a field off, so it leaves here — a
  // field that contributes nothing must not exclude candidates missing it.
  const value = keys
    .map((key, i) => ({ key, weight: parsedWeights[i] }))
    .filter((field) => field.weight > 0);

  if (value.length === 0) {
    return {
      ok: false,
      error: "Every weight is 0 — nothing to compare on.",
    };
  }

  return { ok: true, value };
}

function parsePositions(
  params: URLSearchParams,
):
  | { ok: true; value: CompsPosition[] | null }
  | { ok: false; error: string } {
  const raw = rawList(params, "positions").map((value) => value.toUpperCase());
  if (raw.length === 0) return { ok: true, value: null };

  const unknown = raw.filter((value) => !isCompsPosition(value));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Invalid positions: ${unknown.join(", ")}. Expected QB, RB, WR or TE.`,
    };
  }

  // Deduplicated: the positions are a population filter, a set rather than a
  // list, so repetition carries nothing.
  return { ok: true, value: [...new Set(raw)] as CompsPosition[] };
}
