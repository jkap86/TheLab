import type { CompPair } from "@/shared/contract";

import {
  DEFAULT_K,
  K_MAX,
  K_MIN,
  WEIGHT_MAX,
  WEIGHT_MIN,
  isCriterionId,
  isWindowId,
  pairKey,
} from "./criteria.ts";

/**
 * The comps request, and the one spelling of it on a query string.
 *
 * The client serialises with {@link compsQueryParams} and the route parses with
 * {@link parseCompsQuery}; the serialised string is also the fetch hook's
 * subject key, so anything that changes the question changes the key. Pure,
 * for the same reason `shared/trades/params` is: a parser that quietly read a
 * malformed weight as its default would run a distance the reader did not ask
 * for and print it under the weights they set.
 *
 * **Every parameter is a narrowing of the same question, and an unreadable one
 * is a 400 rather than its default.** That is the opposite call from the
 * trades board's filters, whose neutral form is "not narrowing"; here the
 * neutral form of a weight is not zero and not one, it is *whatever the reader
 * set*, and the only honest answer to a spec the route cannot read is to say
 * so. Absent is different from unreadable: an absent `from`/`to` means the
 * corpus's own bounds, an absent `k` the default, and absent pairs rank
 * nothing — the pool count still answers.
 */
export type CompsRequest = {
  /** The subject's `player_id`, or null for a pool count alone. */
  subject: string | null;
  /** Null means the corpus's own edge. */
  from: number | null;
  to: number | null;
  k: number;
  posLock: boolean;
  excludeOwn: boolean;
  pairs: readonly CompPair[];
};

export type ParsedCompsQuery =
  | { ok: true; request: CompsRequest }
  | { ok: false; error: string };

const PAIRS_PARAM = "c";

/**
 * The request as query parameters. Pairs travel as one comma-separated list of
 * `criterion:window:weight` triples — eleven criteria over four windows is at
 * most 44 of them, ~15 characters each, well inside a request line.
 *
 * The weight is written to one decimal, which is the rail's own step: a
 * floating `0.2 + 0.2` written raw is `0.4000000000000001` and a key that
 * changes on a value the reader cannot see.
 */
export function compsQueryParams(request: CompsRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (request.subject !== null) params.set("subject", request.subject);
  if (request.from !== null) params.set("from", String(request.from));
  if (request.to !== null) params.set("to", String(request.to));
  params.set("k", String(request.k));
  params.set("pos", request.posLock ? "1" : "0");
  params.set("own", request.excludeOwn ? "1" : "0");
  if (request.pairs.length > 0) {
    params.set(
      PAIRS_PARAM,
      request.pairs
        .map((p) => `${p.criterion}:${p.window}:${p.weight.toFixed(1)}`)
        .join(","),
    );
  }
  return params;
}

export function parseCompsQuery(params: URLSearchParams): ParsedCompsQuery {
  const subject = params.get("subject");

  const from = parseSeason(params.get("from"), "from");
  if (!from.ok) return from;
  const to = parseSeason(params.get("to"), "to");
  if (!to.ok) return to;
  if (from.value !== null && to.value !== null && from.value > to.value) {
    return { ok: false, error: "from must not be after to" };
  }

  const k = parseK(params.get("k"));
  if (!k.ok) return k;

  const posLock = parseFlag(params.get("pos"), "pos");
  if (!posLock.ok) return posLock;
  const excludeOwn = parseFlag(params.get("own"), "own");
  if (!excludeOwn.ok) return excludeOwn;

  const pairs = parsePairs(params.get(PAIRS_PARAM));
  if (!pairs.ok) return pairs;

  return {
    ok: true,
    request: {
      subject: subject && subject.length > 0 ? subject : null,
      from: from.value,
      to: to.value,
      k: k.value,
      posLock: posLock.value,
      excludeOwn: excludeOwn.value,
      pairs: pairs.value,
    },
  };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseSeason(raw: string | null, name: string): Parsed<number | null> {
  if (raw === null) return { ok: true, value: null };
  if (!/^\d{4}$/.test(raw)) return { ok: false, error: `Invalid ${name}` };
  return { ok: true, value: Number(raw) };
}

function parseK(raw: string | null): Parsed<number> {
  if (raw === null) return { ok: true, value: DEFAULT_K };
  if (!/^\d{1,2}$/.test(raw)) return { ok: false, error: "Invalid k" };
  const k = Number(raw);
  if (k < K_MIN || k > K_MAX) {
    return { ok: false, error: `k must be between ${K_MIN} and ${K_MAX}` };
  }
  return { ok: true, value: k };
}

function parseFlag(raw: string | null, name: string): Parsed<boolean> {
  if (raw === null) return { ok: true, value: true };
  if (raw === "1") return { ok: true, value: true };
  if (raw === "0") return { ok: true, value: false };
  return { ok: false, error: `Invalid ${name}` };
}

/**
 * The pair list. A pair named twice is a spec error rather than a weight to
 * sum: the panel cannot produce one, so its arrival means the string was not
 * the panel's.
 */
function parsePairs(raw: string | null): Parsed<CompPair[]> {
  if (raw === null || raw === "") return { ok: true, value: [] };
  const pairs: CompPair[] = [];
  const seen = new Set<string>();
  for (const item of raw.split(",")) {
    const [criterion, window, weightRaw, ...rest] = item.split(":");
    if (
      rest.length > 0 ||
      criterion === undefined ||
      window === undefined ||
      weightRaw === undefined ||
      !isCriterionId(criterion) ||
      !isWindowId(window) ||
      !/^\d+(\.\d+)?$/.test(weightRaw)
    ) {
      return { ok: false, error: `Invalid criterion "${item}"` };
    }
    const weight = Number(weightRaw);
    if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
      return {
        ok: false,
        error: `Weight must be between ${WEIGHT_MIN} and ${WEIGHT_MAX}`,
      };
    }
    const key = pairKey(criterion, window);
    if (seen.has(key)) return { ok: false, error: `Duplicate criterion "${key}"` };
    seen.add(key);
    pairs.push({ criterion, window, weight });
  }
  return { ok: true, value: pairs };
}
