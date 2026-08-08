import { NO_LEAGUE_SCOPE_BODY, parseLeagueScopeBody } from "@/shared/query";
import type { LeagueScopeBody } from "@/shared/query";

/**
 * The league ids off a request body, for the routes that answer a POST as
 * readily as a GET.
 *
 * **Three routes take an ADP board and all three can be sent a league scope too
 * long for a request line**, because the board's filters are the shared league
 * rules and their answer is a list of ids — a few thousand of them where a
 * reader has cut a season's corpus roughly in half. `/api/trades` was the first
 * route to meet this and reads its body inline; with a fourth, the ten lines are
 * worth having once, in `src/app` beside `read-failure` and `internal-auth`, for
 * the reason those are: the decision is `shared/query`'s, and what is left is the
 * HTTP adaptation.
 *
 * A body that isn't JSON reads as no body at all rather than as a 400. Every
 * field it can carry is a *narrowing*, and the neutral form of a narrowing is
 * not narrowing — the same leniency `parseTradeQuery` applies to its query
 * string, and the reason a stale link is a broad answer instead of an error
 * page.
 *
 * The parsed scope then rides into `parseAdpFilters`, which lets a body list
 * override the query-string one: they are two spellings of one narrowing and the
 * client sends exactly one, so everything downstream sees a single set of
 * filters and cannot tell which arrived.
 */
export async function readLeagueScope(request: Request): Promise<LeagueScopeBody> {
  if (request.method === "GET") return NO_LEAGUE_SCOPE_BODY;
  const body = await request.json().catch(() => null);
  return parseLeagueScopeBody(body);
}
