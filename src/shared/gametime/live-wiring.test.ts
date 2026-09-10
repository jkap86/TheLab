import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The live room's wiring, pinned against its source.
 *
 * **`crawl-writes.test.ts`' bargain, for the same reason.** `./live` imports
 * `@/shared/manager` and `./feeds` imports `@/shared/projections`, so `npm
 * test` cannot resolve either — the runner strips types and knows nothing of
 * the `@/*` aliases. Every decision in them that *can* be a pure function has
 * been made one (`./live-rules`, `./live-delivery`, `manager/gametime`) and is
 * driven properly by the tests beside this file; what is left is which of
 * those functions the room actually calls, and in what order. Nothing fails
 * when that is wrong: a room that advanced a baseline before the send would
 * typecheck, commit and desynchronise a reader in silence.
 *
 * So this reads the three files and asserts the handful of textual facts their
 * doc comments spend paragraphs arguing for, so that an edit which flattens
 * one has to delete an assertion that says why.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** One function's body, from its signature to the next top-level `}`. */
function body(source: string, signature: string): string {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} should exist`);
  const end = source.indexOf("\n}", start);
  assert.notEqual(end, -1, `${signature} should be terminated`);
  return source.slice(start, end);
}

describe("the room's tick", () => {
  const live = read("src/shared/gametime/live.ts");
  const tick = body(live, "async function tick(room: Room) {");

  test("movement is `feedsMoved`, never a comparison spelled here", () => {
    // The four transitions that were invisible are that function's, and its
    // test drives all of them. A comparison written back into this file would
    // be a second opinion about what a moved feed is.
    assert.match(tick, /const moved = feedsMoved\(previous, feeds\)/);
    assert.doesNotMatch(tick, /feeds\.signature !== previous\.signature/);
  });

  test("clearing a `stale` note forces a frame", () => {
    // Nothing else on this wire takes the warning back off the page: the
    // values behind it can — and usually do — recover unchanged.
    assert.match(tick, /const recovered = room\.toldStale;/);
    assert.match(tick, /if \(!moved && !recovered && !refreshed\.has\(subscriber\)\) continue;/);
    assert.match(tick, /deliver\(room, subscriber, recovered\);/);
  });

  test("the row re-reads are bounded, and happen before anybody's frame", () => {
    assert.match(tick, /await refreshDue\(room, due\)/);
    // The refresh is its own pass, so no reader's frame waits behind another
    // reader's database read.
    assert.ok(
      tick.indexOf("await refreshDue") < tick.indexOf("deliver(room, subscriber"),
      "the refresh pass should precede the delivery walk",
    );
    assert.doesNotMatch(tick, /await refreshRows/);
  });

  test("a re-read already in flight is not started again", () => {
    assert.match(tick, /!subscriber\.refreshing && Date\.now\(\) >= subscriber\.rowsDueAt/);
  });

  const refreshDue = body(live, "async function refreshDue(room: Room, due: readonly Subscriber[]) {");

  test("the fan-out is bounded rather than a `Promise.all`", () => {
    assert.match(refreshDue, /mapWithConcurrency\(\[\.\.\.due\], ROW_REFRESH_CONCURRENCY/);
    assert.doesNotMatch(refreshDue, /Promise\.all/);
  });

  const refreshRows = body(live, "async function refreshRows(room: Room, subscriber: Subscriber) {");

  test("one reader's failed re-read is theirs alone, and still moves the deadline", () => {
    // Caught per subscriber, so a thrown read cannot abandon the rest of the
    // pass; stamped in `finally`, so a failing read is not retried every tick.
    assert.match(refreshRows, /catch \(error\)/);
    assert.match(refreshRows, /finally \{[\s\S]*rowsDueAt\(Date\.now\(\), Math\.random\(\)\)/);
  });
});

describe("the room's delivery", () => {
  const live = read("src/shared/gametime/live.ts");
  const deliver = body(live, "function deliver(room: Room, subscriber: Subscriber, force = false) {");

  test("the baseline moves only on a frame the transport took", () => {
    // The whole of the backpressure contract: `./live-delivery` hands back a
    // state to commit, and this commits it behind the listener's answer.
    assert.match(deliver, /accepted = subscriber\.listener\(frame\)/);
    assert.match(deliver, /if \(accepted\) subscriber\.delivery = next\.commit;/);
    // Never before the send, and never unconditionally.
    assert.doesNotMatch(deliver, /subscriber\.delivery = next\.commit;\s*[\s\S]*listener\(frame\)/);
  });

  test("what to send is `nextDelivery`'s decision", () => {
    assert.match(deliver, /nextDelivery\(subscriber\.delivery, headerJson, payload\.leagues, force\)/);
    assert.match(deliver, /if \(next\.kind === "none"\) return;/);
  });

  const join = body(live, "export async function joinGametime(");

  test("the first frame goes out through the listener like any other", () => {
    // Returned to the route instead, a refused first payload left the room
    // believing a reader held a week they had never been sent.
    assert.match(join, /deliver\(room, subscriber\);/);
    assert.doesNotMatch(join, /firstFrame/);
    assert.doesNotMatch(join, /return \{ ok: true, frame/);
  });
});

describe("the feeds", () => {
  const feeds = read("src/shared/gametime/feeds.ts");
  const payload = read("src/shared/gametime/payload.ts");

  test("a scoreboard read that failed serves a caption and never a factor", () => {
    // The stale map is still shown — a reading twenty seconds old beats none —
    // and is withheld from the pricing, which would otherwise go on dividing
    // the same dead clock into every roster in the league.
    assert.match(feeds, /pricingClocks: read\?\.ok \? clockMap : null,/);
    assert.match(feeds, /clocks: clockMap,/);
  });

  test("the solve reads the pricing clocks and the wire reads the display ones", () => {
    assert.match(payload, /clocks: feeds\.pricingClocks,/);
    assert.match(payload, /board: gameBoard\(feeds\.clocks\),/);
  });
});

describe("the stream route", () => {
  const route = read("src/app/api/user/[username]/gametime/stream/route.ts");

  test("backpressure is counted in bytes", () => {
    // A count of frames bounds nothing on a stream whose frames run from a
    // two-byte heartbeat to a whole week of a hundred-league account.
    assert.match(route, /new ByteLengthQueuingStrategy\(\{ highWaterMark: QUEUE_BYTES \}\)/);
    assert.doesNotMatch(route, /CountQueuingStrategy/);
  });

  test("a refused frame is reported to the room rather than swallowed", () => {
    assert.match(route, /if \(\(unread \+= 1\) >= MAX_UNREAD\) finish\(\);\s*\n\s*return false;/);
    assert.match(route, /return write\(`data: \$\{frame\.json\}/);
  });
});
