import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";

/**
 * The live room's wiring, pinned against its source.
 *
 * **`crawl-writes.test.ts`' bargain, for the same reason.** `./feeds` imports
 * `@/shared/projections` and `./live` imports `@/shared/manager`, so `npm
 * test` cannot resolve either — the runner strips types and knows nothing of
 * the `@/*` aliases. The room itself (`./live-room`) takes those as arguments
 * now and `live-room.test.ts` drives its timer chain for real; what is left
 * here is the handful of decisions that are still *which* function is called
 * and in what order, and the wiring in `./live` and the feed reader, neither
 * of which a scripted room can reach. Nothing fails when one of those is
 * wrong: a room that advanced a baseline before the send would typecheck,
 * commit and desynchronise a reader in silence.
 *
 * So this reads the files and asserts the textual facts their doc comments
 * spend paragraphs arguing for, so that an edit which flattens one has to
 * delete an assertion that says why.
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
  const live = read("src/shared/gametime/live-room.ts");
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

  test("the cadence is `tickIntervalMs`'s, and a closed room is never armed", () => {
    // `pollIntervalMs` answers null for an all-final board, and that null used
    // to be the whole decision: a week whose stats feed was down stopped being
    // read the moment its scoreboard read final, under a `Final` caption. The
    // finalization policy is `tickIntervalMs`'s last arm, and `schedule` is the
    // only thing that arms a timer — after asking whether the room it was
    // handed is still the one its key names.
    const schedule = body(live, "function schedule(room: Room) {");
    assert.match(schedule, /const interval = tickIntervalMs\(\{/);
    assert.match(schedule, /incomplete: feedsIncomplete\(room\.feeds\.statuses\)/);
    assert.match(schedule, /settledSince: room\.settledSince/);
    assert.match(schedule, /if \(!isOpen\(room\)\) return;/);
    assert.doesNotMatch(schedule, /pollIntervalMs\(/);
    // A failed read whole breaks the settling run; a healthy one folds it.
    assert.match(tick, /room\.settledSince = null;/);
    assert.match(tick, /room\.settledSince = settledSince\(room\.settledSince, \{/);
    // And every resumption after an await asks for the room by identity.
    assert.doesNotMatch(tick, /rooms\.has\(room\.key\)/);
    assert.match(tick, /if \(!isOpen\(room\)\) return;/);
  });

  test("the room opened on an already-final week folds the same state", () => {
    const open = body(live, "async function openRoom(");
    assert.match(open, /failures: feedsFailed\(feeds\.statuses\) \? 1 : 0,/);
    assert.match(open, /settledSince: settledSince\(null, \{/);
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
    assert.match(tick, /!subscriber\.refreshing && now >= subscriber\.rowsDueAt/);
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
    assert.match(refreshRows, /finally \{[\s\S]*rowsDueAt\(deps\.now\(\), deps\.random\(\)\)/);
  });
});

describe("the room's delivery", () => {
  const live = read("src/shared/gametime/live-room.ts");
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
    assert.match(
      deliver,
      /nextDelivery\(\s*subscriber\.delivery,\s*headerJson,\s*payload\.leagues,\s*payload\.players,\s*force,?\s*\)/,
    );
    assert.match(deliver, /if \(next\.kind === "none"\) return;/);
  });

  test("the stat board is diffed, never carried on the header", () => {
    // The header is re-serialised on every tick — `read_at` alone sees to
    // that — so a field named in it is sent whole to every reader every
    // twenty seconds. The board is a few hundred rows whose identity half
    // cannot change all week, and most readers never open it. Named there it
    // would silently be the largest thing on this wire.
    const header = body(live, "function headerOf(");
    assert.doesNotMatch(header, /players:/);
    assert.match(deliver, /for \(const id of next\.players\.changed\)/);
    assert.match(deliver, /removed_players: next\.players\.removed,/);
  });

  const join = body(live, "async function joinGametime(");

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

  test("the stat board is folded off the stat lines, never the projections", () => {
    // Both feeds fold into the same shape, so handing this the wrong one
    // typechecks and produces a full, plausible, entirely fictional week:
    // the projections feed carries a row for every player in the league
    // whether or not a ball has been snapped.
    assert.match(payload, /players: statBoardLines\(feeds\.stats\),/);
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

  test("the room's listener is the stream's own send, so a refusal reaches the room", () => {
    // The refusal mechanics — a droppable frame on a stalled socket answers
    // `false` and counts toward the disconnect, a transition is never dropped —
    // are `shared/streams/sse`' and are driven for real in `sse.test.ts`. What
    // is the route's own is *which* frames may be dropped and that the room is
    // handed the stream's `send` unwrapped, so the boolean it answers is the
    // one the baseline is committed behind.
    assert.match(route, /const DROPPABLE = new Set<RoomFrame\["type"\]>\(\["payload", "delta"\]\)/);
    assert.match(route, /droppable: DROPPABLE/);
    assert.match(route, /joinGametime\(\{ userId, username, season, week \}, send\)/);
  });
});

describe("the two stream routes admit before they work", () => {
  // Admission is one module and the property that matters — every path
  // releases exactly once, a disconnect during the first read seats nobody —
  // is driven in `shared/streams/sse.test.ts`. What only a route can get wrong
  // is the order: a reservation taken *after* the user is resolved is a
  // pending connection nothing counted, and an `onClose` that forgot to
  // release is a slot leaked on every ordinary disconnect. Both typecheck.
  const routes = {
    gametime: read("src/app/api/user/[username]/gametime/stream/route.ts"),
    picktracker: read("src/app/api/picktracker/[leagueId]/stream/route.ts"),
  };

  for (const [name, route] of Object.entries(routes)) {
    test(`${name}: the reservation is the handler's first statement`, () => {
      const handler = body(route, "export async function GET(");
      const reserve = handler.indexOf("streamAdmission.reserve({");
      const firstAwait = handler.indexOf("await ");
      assert.notEqual(reserve, -1);
      assert.ok(firstAwait === -1 || reserve < firstAwait, "reserve before any await");
      assert.match(handler, /if \(!reservation\.ok\) return streamRefusalResponse\(reservation\);/);
      assert.match(handler, /withStreamReservation\(reservation, request\.signal,/);
    });

    test(`${name}: the stream's close is the reservation's release`, () => {
      assert.match(route, /onClose: \(\) => reservation\.release\(\)/);
      assert.doesNotMatch(route, /reservation\.release\(\)(?![,)])/m);
    });

    test(`${name}: the opening slot is claimed only for a cold open and handed back in a finally`, () => {
      assert.match(route, /if \(!(?:hasGametimeRoom\(season, week\)|hasRoom\(leagueId\))\) \{\s*\n\s*const opening = reservation\.beginOpening\(\);/);
      assert.match(route, /if \(!opening\.ok\) return streamRefusalResponse\(opening\);/);
      assert.match(route, /\} finally \{[^}]*reservation\.endOpening\(\);/);
    });

    test(`${name}: the subject is seated before the opening is claimed`, () => {
      const attach = route.indexOf("reservation.attach(");
      const opening = route.indexOf("reservation.beginOpening(");
      assert.notEqual(attach, -1);
      assert.ok(attach < opening, "attach before beginOpening");
      assert.match(route, /if \(!seated\.ok\) return streamRefusalResponse\(seated\);/);
    });
  }
});
