import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { LeagueSyncPayload } from "@/shared/contract";

import { lastUpdatedNote, syncStatusNote } from "./sync-status.ts";

/**
 * What the panel's sync key promises a reader, none of which a type can carry.
 *
 * The rule is one sentence with two halves — a press that changed something says
 * nothing, a press that fetched nothing speaks — and both halves fail silently:
 * get the first wrong and a permanent badge sits on a band that is otherwise a
 * control; get the second wrong and a reader who has just changed a lineup is
 * looking at unchanged rows with nothing on screen to say why.
 */

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

describe("syncStatusNote", () => {
  test("a press that has not landed says nothing beside the key", () => {
    // The key's own label and turning mark report it; a note would be the same
    // fact twice on one band.
    assert.equal(syncStatusNote(true, null, null), null);
    assert.equal(syncStatusNote(true, answer(), "boom"), null);
  });

  test("nothing has been pressed yet, so there is nothing to report", () => {
    assert.equal(note(null), null);
  });

  test("both successes are silent, because the rows are the answer", () => {
    // `fresh` is a success under another name — somebody else's refresh landed
    // while this caller queued — so telling the two apart on screen would be
    // reporting the plumbing rather than the league.
    assert.equal(note(answer({ status: "synced" })), null);
    assert.equal(note(answer({ status: "fresh" })), null);
  });

  test("every press that fetched nothing speaks", () => {
    // The half that matters: each of these leaves the screen exactly as it was.
    for (const status of ["cooldown", "locked", "gone", "failed"] as const) {
      const spoken = note(answer({ status, synced: false }));
      assert.notEqual(spoken, null, `${status} must say something`);
      assert.ok(spoken!.text.length > 0);
      assert.ok(spoken!.speech.length > 0);
    }
  });

  test("`synced` is the whole test for silence, so the two agree", () => {
    // The payload carries the boolean precisely so a client needn't derive it
    // from the union, and this is that agreement: silent exactly when synced.
    for (const status of [
      "synced", "fresh", "cooldown", "locked", "gone", "failed",
    ] as const) {
      const result = answer({ status, synced: status === "synced" || status === "fresh" });
      assert.equal(
        note(result) === null,
        result.synced,
        `${status} disagrees with its own synced flag`,
      );
    }
  });

  test("only an unreadable league takes the attention tone", () => {
    // A cooldown and a refresh already running are ordinary operation. Painting
    // them amber would put a warning on a league that is perfectly current.
    assert.equal(note(answer({ status: "cooldown" }))!.tone, "muted");
    assert.equal(note(answer({ status: "locked" }))!.tone, "muted");
    assert.equal(note(answer({ status: "gone" }))!.tone, "attention");
    assert.equal(note(answer({ status: "failed" }))!.tone, "attention");
  });

  test("a transport failure carries the server's own message, not a stand-in", () => {
    // It never reached the route, so there is no status to read — and the
    // server's message is the only thing that can say more than "it didn't work".
    const spoken = syncStatusNote(false, null, "Too many refreshes right now.");
    assert.equal(spoken?.speech, "Too many refreshes right now.");
    assert.equal(spoken?.tone, "attention");
  });

  describe("the cooldown's spoken wait", () => {
    test("rounds up, so it never sends a reader back a moment too early", () => {
      const spoken = note(answer({ status: "cooldown", retry_after_ms: 4_100 }));
      assert.match(spoken!.speech, /5 seconds/);
    });

    test("is never zero seconds, which reads as 'now' and is not", () => {
      const spoken = note(answer({ status: "cooldown", retry_after_ms: 120 }));
      assert.match(spoken!.speech, /1 seconds/);
    });
  });
});

describe("lastUpdatedNote", () => {
  test("says nothing where there is nothing to say", () => {
    assert.equal(lastUpdatedNote(null), "");
    assert.equal(lastUpdatedNote(answer({ updated_at: null })), "");
  });

  test("an unparseable timestamp is silence, never `Invalid Date`", () => {
    // The string exists to reassure; a broken one does the opposite.
    assert.equal(lastUpdatedNote(answer({ updated_at: "not a date" })), "");
  });

  test("a real timestamp is appended as a clause, not as a sentence", () => {
    // It rides on the end of the key's hover, so it has to join rather than
    // start — a leading capital would read as a second title.
    const said = lastUpdatedNote(
      answer({ updated_at: "2026-08-13T17:04:00.000Z" }),
    );
    assert.match(said, /^ · last updated /);
  });
});
