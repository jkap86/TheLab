import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { compsState } from "./comps-state.ts";

import type { CompsPayload } from "./types.ts";

/**
 * The one rule `keepPreviousData` needs bounding by: a held payload may answer
 * an older *comparison*, never an older *player*.
 *
 * The failure it fixes is not a rendering glitch — the heading is state and
 * moves on the press, the payload is a fetch and lags it, so for the length of
 * the new request the page asserted that one player's comps belonged to
 * another. Weight and window edits keep the old behaviour precisely because the
 * subject is unchanged there.
 */

const payload = (playerId: string, name = playerId): CompsPayload =>
  ({
    subject: { player_id: playerId, name, season: "2025" },
    results: [{ player_id: `comp-of-${playerId}` }],
  }) as unknown as CompsPayload;

const snapshot = (
  over: Partial<Parameters<typeof compsState>[0]> = {},
): Parameters<typeof compsState>[0] => ({
  data: undefined,
  error: null,
  isFetching: false,
  isPlaceholderData: false,
  ...over,
});

describe("compsState — same player, comparison changed", () => {
  test("a held payload for the same player stays on screen, flagged stale", () => {
    // A weight notch moved: the rows are still about this player, so blanking
    // several hundred of them to redraw them nearly unchanged is the flash the
    // whole placeholder mechanism exists to avoid.
    const state = compsState(
      snapshot({
        data: payload("4034"),
        isFetching: true,
        isPlaceholderData: true,
      }),
      "4034",
    );
    assert.equal(state.data?.subject.player_id, "4034");
    assert.equal(state.stale, true);
    assert.equal(state.loading, true);
  });

  test("a window change is the same case — the subject is what is checked", () => {
    // Nothing here reads the query string: a re-key that kept the player is
    // indistinguishable from any other, which is exactly the intent.
    const state = compsState(
      snapshot({
        data: payload("4034"),
        isFetching: true,
        isPlaceholderData: true,
      }),
      "4034",
    );
    assert.ok(state.data, "the previous board is preserved");
  });

  test("a settled answer for the current player is not stale", () => {
    const state = compsState(snapshot({ data: payload("4034") }), "4034");
    assert.equal(state.stale, false);
    assert.equal(state.loading, false);
    assert.deepEqual(state.data, payload("4034"));
  });
});

describe("compsState — a different player was picked", () => {
  test("player A's comps are never shown under player B", () => {
    const state = compsState(
      snapshot({
        data: payload("4034"),
        isFetching: true,
        isPlaceholderData: true,
      }),
      "6786",
    );
    assert.equal(state.data, null, "withheld rather than relabelled");
    assert.equal(state.loading, true, "and the page shows it is loading");
  });

  test("withheld data is never also reported stale", () => {
    // `stale` dims rows that are on screen. With nothing on screen it would be
    // dimming an absence, and the caller would draw an "Updating…" note over a
    // list that isn't there.
    const state = compsState(
      snapshot({
        data: payload("4034"),
        isFetching: true,
        isPlaceholderData: true,
      }),
      "6786",
    );
    assert.equal(state.stale, false);
  });

  test("player B's own answer appears as soon as it arrives", () => {
    const state = compsState(snapshot({ data: payload("6786") }), "6786");
    assert.equal(state.data?.subject.player_id, "6786");
    assert.equal(state.data?.results[0].player_id, "comp-of-6786");
    assert.equal(state.stale, false);
  });

  test("a settled payload for the wrong player is withheld too, not just a placeholder", () => {
    // Placeholder or not, a payload about someone else is a false claim under
    // the heading on screen.
    const state = compsState(snapshot({ data: payload("4034") }), "6786");
    assert.equal(state.data, null);
  });
});

describe("compsState — the edges", () => {
  test("no subject picked holds whatever arrives", () => {
    // Nothing on screen names a player, so there is no claim to contradict.
    const state = compsState(snapshot({ data: payload("4034") }), null);
    assert.equal(state.data?.subject.player_id, "4034");
  });

  test("no data is no data, whoever is selected", () => {
    const state = compsState(snapshot({ isFetching: true }), "4034");
    assert.equal(state.data, null);
    assert.equal(state.stale, false);
    assert.equal(state.loading, true);
  });

  test("the error travels whatever the subject", () => {
    const state = compsState(
      snapshot({ error: "Failed to compute comps" }),
      "6786",
    );
    assert.equal(state.error, "Failed to compute comps");
  });
});
