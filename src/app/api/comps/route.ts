import { NextResponse } from "next/server";

import { isEligible, parseCompsQuery, rankComps } from "@/shared/comps";
import type { ApiErrorPayload, CompsPayload } from "@/shared/contract";
import { corpusBounds, getCompCorpus, toCompMatch } from "@/shared/player-seasons";
import type { CompCorpus } from "@/shared/player-seasons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The ranked comps for one subject under one set of weighted pairs.
 *
 * **The distance runs here rather than in the browser**, which the handoff
 * recommends and the corpus decides: twenty-six sample rows are trivial
 * anywhere, and eight thousand real player-seasons over eleven criteria and
 * four windows are not a thing to ship to a phone on every rail move. The
 * z-scoring, the pool filter and the ranking are `shared/comps`, pure and
 * tested; this handler reads the corpus, narrows it and maps the answer to
 * the wire, and the browser draws chips off the pair gaps it is handed
 * without recomputing anything.
 *
 * **An unreadable parameter is a 400**, every one of them — see
 * `parseCompsQuery` for why that is the opposite of the trades board's rule.
 * An unknown subject is a 404, since there is genuinely no such player here;
 * no subject at all is neither, and answers the pool count with no comps,
 * which is what the pool strip reads before a player is picked.
 */
export async function GET(request: Request) {
  const parsed = parseCompsQuery(new URL(request.url).searchParams);
  if (!parsed.ok) {
    const error: ApiErrorPayload = { error: parsed.error };
    return NextResponse.json(error, { status: 400 });
  }
  const query = parsed.request;

  let corpus: CompCorpus;
  try {
    corpus = await getCompCorpus();
  } catch (error) {
    console.error("[comps] corpus read failed:", error);
    const payload: ApiErrorPayload = { error: "Failed to load the comps corpus" };
    return NextResponse.json(payload, { status: 500 });
  }

  const subject =
    query.subject === null
      ? null
      : (corpus.subjects.find((s) => s.player_id === query.subject) ?? undefined);
  if (subject === undefined) {
    const error: ApiErrorPayload = { error: "No such player" };
    return NextResponse.json(error, { status: 404 });
  }

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

  const comps =
    subject === null
      ? []
      : rankComps(subject, pool, query.pairs).slice(0, query.k).map(toCompMatch);

  const payload: CompsPayload = {
    source: corpus.source,
    subject: subject?.player_id ?? null,
    pool: { eligible: pool.length, total: corpus.seasons.length },
    pairs: [...query.pairs],
    comps,
  };

  return NextResponse.json(payload, {
    headers: {
      // The corpus moves once a year and the question is the whole URL, so a
      // reader who moves a rail and moves it back costs nothing.
      "Cache-Control": "private, max-age=60",
    },
  });
}
