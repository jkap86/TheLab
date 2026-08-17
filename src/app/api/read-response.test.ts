import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";

import { readFailureResponse } from "./read-failure.ts";
import { readResponse } from "./read-response.ts";

/**
 * The line between "the domain answered nothing" and "this read did not answer".
 *
 * Both used to arrive at a browser as `200 null`, which is the failure this file
 * exists to keep fixed — and it is a failure nothing else could have caught. A
 * route that swallows a database timeout into a null body still typechecks, still
 * answers, still draws the em dash the columns draw when a league genuinely has
 * nothing to project, and simply tells the client the request worked. Every
 * consequence is downstream and silent: no retry, because there was no failure to
 * retry, and the empty answer cached as a *successful* one for the entry's whole
 * stale time.
 *
 * So the assertions are about the response and not about the read: what status
 * came back, what the body was, and — the one that pins the regression — that a
 * failure's body is never the shape a real answer takes.
 *
 * These drive `readResponse` rather than the two route handlers, which cannot be
 * called in this runner (they open a pool and await Next's `params`). It is the
 * whole of what those handlers do with a read once the league is resolved:
 * `…/week` and `…/outlook` are three fields and a callback each, and
 * `league-routes.test.ts` is what pins that they still route through here.
 */

/** A busy database, in each of the four spellings `isDatabaseBusy` knows. */
const BUSY: ReadonlyArray<readonly [string, unknown]> = [
  ["statement_timeout cancelled the query", pgError("57014")],
  ["lock_timeout gave up waiting", pgError("55P03")],
  ["the role is out of connections", pgError("53300")],
  [
    "the pool never handed one over",
    new Error("timeout exceeded when trying to connect"),
  ],
];

function pgError(code: string): Error {
  return Object.assign(new Error(`database said ${code}`), { code });
}

/** One league's week, as the route serialises it — enough to be recognisable. */
const WEEK = {
  week: 5,
  ppg_source: { season: "2026", weeks: 4, prior: false },
  projection: { "4034": 18.2 },
  ppg: { "4034": { average: 16.1, games: 4 } },
  team_projection: {},
  team_ppg: {},
  games: {},
};

/**
 * Read a response the way `apiFetch` does — the body, whatever the status.
 *
 * The status alone is not the assertion: half of what regressed was *what the
 * body was*, and a 500 carrying `null` would pass a status-only check while
 * still being a failure dressed as an answer.
 */
async function answer(res: Response) {
  return {
    status: res.status,
    retryAfter: res.headers.get("Retry-After"),
    body: (await res.json()) as unknown,
  };
}

/** The routes log every failure; the runner does not need to see it. */
function quiet(t: TestContext): void {
  t.mock.method(console, "error", () => {});
}

const read = <T>(value: T) => ({
  label: "league.week",
  subject: "league=123 week=5",
  failure: "Failed to read this week",
  read: async () => value,
});

const throwing = (error: unknown) => ({
  label: "league.outlook",
  subject: "league=123",
  failure: "Failed to project this league",
  read: async (): Promise<never> => {
    throw error;
  },
});

describe("a read that answered", () => {
  test("crosses as a 200 carrying what it returned", async () => {
    const { status, body } = await answer(await readResponse(read(WEEK)));
    assert.equal(status, 200);
    assert.deepEqual(body, WEEK);
  });

  test("a legitimate null is an answer like any other", async (t) => {
    quiet(t);
    // `…/outlook`'s one real null: no slots on file, no scoring settings to score
    // with, or no weeks left on the schedule. It is a fact about the league, so
    // it is a 200 — and it has to stay one, or fixing the failure case would
    // simply move the lie to the other side.
    const { status, body } = await answer(await readResponse(read(null)));
    assert.equal(status, 200);
    assert.equal(body, null);
  });

  test("an empty answer is still an answer", async () => {
    // A week whose maps are all empty is a league nobody has projections for,
    // not a read that failed — the distinction the serialisation keeps.
    const empty = { ...WEEK, projection: {}, ppg: {} };
    const { status, body } = await answer(await readResponse(read(empty)));
    assert.equal(status, 200);
    assert.deepEqual(body, empty);
  });
});

describe("a read that ran out of the database's budget", () => {
  for (const [what, error] of BUSY) {
    test(`${what} is a 503 asking to be retried`, async (t) => {
      quiet(t);
      const { status, retryAfter, body } = await answer(
        await readResponse(throwing(error)),
      );

      // Nothing is broken and the same read would have worked a second later,
      // which is the one thing a caller can act on — so it is the status that
      // says come back, and it carries the header that says when.
      assert.equal(status, 503);
      assert.equal(retryAfter, "1");
      assert.deepEqual(body, {
        error: "The database is busy right now. Try again in a moment.",
      });
    });
  }

  test("it is never mistaken for the read having no answer", async (t) => {
    quiet(t);
    const { status, body } = await answer(await readResponse(throwing(pgError("57014"))));

    // The regression, stated as its two halves: not a success, and not a null.
    // Either one alone would still leave a busy minute cached as a league with
    // nothing to project.
    assert.notEqual(status, 200);
    assert.notEqual(body, null);
  });
});

describe("a read that broke", () => {
  test("is a 500 carrying the route's own sentence", async (t) => {
    quiet(t);
    const { status, retryAfter, body } = await answer(
      await readResponse(throwing(new Error("column pts_ppr does not exist"))),
    );

    // Asking again will be wrong the same way, which is what separates this from
    // the 503 — and why it carries no `Retry-After`.
    assert.equal(status, 500);
    assert.equal(retryAfter, null);
    assert.deepEqual(body, { error: "Failed to project this league" });
  });

  test("the read's own message is not what the caller is shown", async (t) => {
    quiet(t);
    const { body } = await answer(
      await readResponse(throwing(new Error("relation \"rosters\" does not exist"))),
    );
    // A query's text is a fact about this app's schema, and the caller gets the
    // sentence the route chose. The detail is in the log line above it.
    assert.deepEqual(body, { error: "Failed to project this league" });
  });

  test("a throw that is not an Error is still a failure", async (t) => {
    quiet(t);
    // `catch` binds `unknown`, and a rejection from a layer this app does not
    // own can be anything at all — the one outcome that must not follow is a
    // 200.
    for (const thrown of [null, undefined, "boom", { code: 57014 }, 503]) {
      const { status, body } = await answer(await readResponse(throwing(thrown)));
      assert.equal(status, 500, String(thrown));
      assert.deepEqual(body, { error: "Failed to project this league" });
    }
  });

  test("a synchronous throw is caught too, not left to escape", async (t) => {
    quiet(t);
    // The read is called *inside* the `try`, so a callback that throws before
    // returning a promise is the same failure as one that rejects. Written the
    // other way round it would escape past the handler and reach the client as
    // whatever the platform makes of an unhandled rejection.
    const { status, body } = await answer(
      await readResponse({
        label: "league.week",
        subject: "league=123 week=5",
        failure: "Failed to read this week",
        read: () => {
          throw new Error("thrown before the promise");
        },
      }),
    );
    assert.equal(status, 500);
    assert.deepEqual(body, { error: "Failed to read this week" });
  });
});

describe("the failure helper the routes share", () => {
  test("draws the same line on its own", async () => {
    // `readResponse` is the composition; this is the policy inside it, asserted
    // directly so a route that catches its own read (`values`, `timeline`) is
    // covered by the same claim.
    const busy = await answer(readFailureResponse(pgError("55P03"), "Failed to load"));
    assert.equal(busy.status, 503);
    assert.equal(busy.retryAfter, "1");

    const broken = await answer(readFailureResponse(new Error("nope"), "Failed to load"));
    assert.equal(broken.status, 500);
    assert.deepEqual(broken.body, { error: "Failed to load" });
  });
});
