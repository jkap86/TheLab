import { NextResponse } from "next/server";

import {
  MIN_WEIGHTED_COVERAGE,
  compsQueryParams,
  isCompPosition,
  isEligible,
  parseCompsQuery,
  rankComps,
} from "@/shared/comps";
import type { ApiErrorPayload, CompsPayload } from "@/shared/contract";
import {
  compsAnswerCache,
  compsAnswerKey,
  corpusBounds,
  getCompCorpus,
  toCompMatch,
} from "@/shared/player-seasons";
import type { CorpusRead } from "@/shared/player-seasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ranked comps for one subject under one set of weighted pairs.
 *
 * **The distance runs here rather than in the browser**, which the handoff
 * recommends and the corpus decides: twenty-six sample rows are trivial
 * anywhere, and thousands of real player-seasons over eleven criteria and four
 * windows are not a thing to ship to a phone on every rail move. The
 * z-scoring, the coverage gate, the similarity calibration, the pool filter
 * and the ranking are `shared/comps`, pure and tested; this handler reads the
 * corpus, narrows it and maps the answer to the wire, and the browser draws
 * chips off the pair gaps it is handed without recomputing anything.
 *
 * **An unreadable parameter is a 400**, every one of them — see
 * `parseCompsQuery` for why that is the opposite of the trades board's rule.
 * An unknown subject is a 404, since there is genuinely no such player here,
 * and so is a subject at a position this feature does not comp: a kicker
 * compared on receiving yards would be a board of zeroes wearing a name.
 * No subject at all is neither, and answers the pool count with no comps,
 * which is what the pool strip reads before a player is picked.
 *
 * **A corpus that has not been loaded is a 200, not an error.** `source:
 * "unavailable"` with empty lists is a state the page can explain; an error
 * string is one it can only print. A database that cannot be *read* is still a
 * 500 — the two are different sentences and they get different answers.
 */
export async function GET(request: Request) {
  const parsed = parseCompsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const query = parsed.request;

  let read: CorpusRead;
  try {
    read = await getCompCorpus();
  } catch (error) {
    console.error("[comps] corpus read failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load the comps corpus" };
    return NextResponse.json(payload, { status: 500 });
  }
  const { corpus, info } = read;

  if (corpus.source === "unavailable") {
    return answer({
      source: corpus.source,
      subject: null,
      position: null,
      pool: { eligible: 0, total: 0, ranked: 0, excluded_low_coverage: 0 },
      corpus_info: info,
      min_coverage: MIN_WEIGHTED_COVERAGE,
      subject_coverage: 0,
      pairs: [...query.pairs],
      comps: [],
    });
  }

  const subject =
    query.subject === null
      ? null
      : (corpus.subjects.find((s) => s.player_id === query.subject) ?? undefined);
  if (subject === undefined) {
    const error: ApiErrorPayload = { error: "No such player" };
    return NextResponse.json(error, { status: 404 });
  }
  if (subject !== null && !isCompPosition(subject.position)) {
    const error: ApiErrorPayload = {
      error: `Comps are not available for ${subject.position}`,
    };
    return NextResponse.json(error, { status: 404 });
  }

  // The whole question, normalised, plus the corpus build it would run
  // against: two identical questions over one corpus have one answer, and a
  // load moves the version and invalidates every entry at once.
  const cacheKey = compsAnswerKey({
    version: info.version,
    query: compsQueryParams(query).toString(),
    minCoverage: MIN_WEIGHTED_COVERAGE,
  });
  const cache = compsAnswerCache();
  const hit = cache.get(cacheKey);
  if (hit) return answer(hit);

  // An absent edge is the corpus's own, read off the data rather than a
  // constant — a table that gains a season widens the default range with no
  // edit here.
  const bounds = corpusBounds(corpus);
  const pool = corpus.seasons.filter((s) =>
    isEligible(s, subject, {
      posLock: query.posLock,
      excludeOwn: query.excludeOwn,
      from: query.from ?? bounds.from,
      to: query.to ?? bounds.to,
    }),
  );

  const ranking =
    subject === null ? null : rankComps(subject, pool, query.pairs);

  const payload: CompsPayload = {
    source: corpus.source,
    subject: subject?.player_id ?? null,
    position: subject?.position ?? null,
    pool: {
      eligible: pool.length,
      total: corpus.seasons.length,
      ranked: ranking?.ranked.length ?? 0,
      excluded_low_coverage: ranking?.excludedLowCoverage ?? 0,
    },
    corpus_info: info,
    min_coverage: MIN_WEIGHTED_COVERAGE,
    subject_coverage: ranking?.subjectCoverage ?? 0,
    pairs: [...query.pairs],
    comps: ranking ? ranking.ranked.slice(0, query.k).map(toCompMatch) : [],
  };

  // Only an answer this handler is about to return 200 with is held: a 400, a
  // 404 and a 500 are all decided above.
  cache.set(cacheKey, payload);
  return answer(payload);
}

function answer(payload: CompsPayload) {
  return NextResponse.json(payload, {
    headers: {
      // The corpus moves once a year and the question is the whole URL, so a
      // reader who moves a rail and moves it back costs nothing.
      "Cache-Control": "private, max-age=60",
    },
  });
}
