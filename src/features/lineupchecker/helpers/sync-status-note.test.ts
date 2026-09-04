import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeagueSyncPayload } from "@/shared/contract";
import { syncStatusNote } from "./sync-status-note.ts";

const answer = (over: Partial<LeagueSyncPayload> = {}): LeagueSyncPayload => ({
  league_id: "123",
  status: "synced",
  synced: true,
  retry_after_ms: 0,
  updated_at: null,
  ...over,
});

const note = (result: LeagueSyncPayload | null) =>
  syncStatusNote(false, result, null);

/** Every status that leaves the screen exactly as the reader found it. */
const REFUSALS = [
  answer({ status: "cooldown", synced: false, retry_after_ms: 9_000 }),
  answer({ status: "locked", synced: false }),
  answer({ status: "gone", synced: false }),
  answer({ status: "failed", synced: false }),
];

describe("syncStatusNote", () => {
  test("a success says nothing", () => {
    // The numbers changing on the card are the answer. A badge on top of that
    // is the key congratulating itself, a hundred times over on a full page.
    assert.equal(note(answer({ status: "synced", synced: true })), null);
  });

  test("a race is a success too, and equally silent", () => {
    // Somebody else's refresh landed while this press queued. The reader is
    // looking at current data, which is what they asked for.
    assert.equal(note(answer({ status: "fresh", synced: true })), null);
  });

  test("nothing pressed yet says nothing", () => {
    // The note is about a press, not about a resting card.
    assert.equal(syncStatusNote(false, null, null), null);
  });

  test("every press that fetched nothing speaks", () => {
    // The load-bearing case: a completeness assertion, so a refusal can never
    // become invisible and leave the key looking dead.
    for (const result of REFUSALS) {
      const n = note(result);
      assert.ok(n, result.status);
      assert.ok(n.text.length > 0, result.status);
      assert.ok(n.title.length > 0, result.status);
    }
  });

  test("a status this build has no words for still speaks, and names itself", () => {
    const n = note(answer({ status: "reticulating" as never, synced: false }));
    assert.ok(n);
    assert.equal(n.alert, true);
    assert.match(n.title, /reticulating/);
  });

  test("tone separates nothing-to-do from something-is-wrong", () => {
    assert.equal(note(answer({ status: "cooldown", synced: false }))?.alert, false);
    assert.equal(note(answer({ status: "locked", synced: false }))?.alert, false);
    assert.equal(note(answer({ status: "gone", synced: false }))?.alert, true);
    assert.equal(note(answer({ status: "failed", synced: false }))?.alert, true);
  });

  test("the cooldown rounds up", () => {
    // A reader told "1s" who presses at one second would be refused again.
    const n = note(
      answer({ status: "cooldown", synced: false, retry_after_ms: 1_200 }),
    );
    assert.equal(n?.text, "Wait 2s");
  });

  test("the cooldown never reads zero", () => {
    // "Wait 0 seconds" under a key that is actively refusing is a contradiction
    // the reader acts on immediately, and is refused again.
    const n = note(
      answer({ status: "cooldown", synced: false, retry_after_ms: 0 }),
    );
    assert.equal(n?.text, "Wait 1s");
  });

  test("one second is singular", () => {
    const n = note(
      answer({ status: "cooldown", synced: false, retry_after_ms: 1_000 }),
    );
    assert.match(n?.title ?? "", /1 second\b/);
    assert.doesNotMatch(n?.title ?? "", /1 seconds/);
  });

  test("pending outranks a previous answer", () => {
    // A stale wait sitting under a live press is a lie about the press the
    // reader is watching right now.
    const n = syncStatusNote(
      true,
      answer({ status: "cooldown", synced: false, retry_after_ms: 9_000 }),
      null,
    );
    assert.equal(n?.text, "Syncing…");
    assert.equal(n?.alert, false);
  });

  test("pending outranks an error too", () => {
    assert.equal(syncStatusNote(true, null, "boom")?.text, "Syncing…");
  });

  test("a transport failure carries the server's words, not ours", () => {
    const n = syncStatusNote(false, null, "League not found");
    assert.equal(n?.alert, true);
    assert.equal(n?.title, "League not found");
  });
});
