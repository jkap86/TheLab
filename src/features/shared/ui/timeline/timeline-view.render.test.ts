import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { installFetchMock, withQueryClient } from "../../query-test-support.ts";
import { TimelineView } from "./timeline-view.tsx";

/**
 * What a host draws before anybody has asked for the history.
 *
 * **The claim this pins is a request that is *not* made.** Mounting a league
 * card used to start `/api/league/:id/timeline` — the heaviest read either host
 * makes — at exactly the moment the panel beside it was making its own, so a
 * card opened to glance at the standings paid for a season of moves nobody
 * scrubbed. What replaced it is a key, and a key is easy to delete by accident
 * while "simplifying" the four states in that seat back into one.
 *
 * `renderToStaticMarkup` runs no effects, so what the fetch mock proves here is
 * narrow but exact: nothing is requested *during render*, and the markup is a
 * key rather than a rail. That the press is what fetches — and that a second
 * open reuses the answer — is a request-count claim, and it is pinned as one in
 * `features/shared/league-cache.test.ts`.
 */

function view(source: Parameters<typeof TimelineView>[0]["source"]): string {
  // The children are the third argument rather than a prop — the same call
  // either way, and the lint rule is right that only one of the two spellings
  // should exist. The cast is what lets it be written that way: `createElement`
  // insists a required `children` prop be in the props object, which is exactly
  // what passing it positionally satisfies at runtime.
  const props = { source } as Parameters<typeof TimelineView>[0];
  return renderToStaticMarkup(
    withQueryClient(
      createElement(TimelineView, props, createElement("div", null, "the panel")),
    ),
  );
}

describe("a host that nobody has opened the history on", () => {
  test("draws a History key and no rail", () => {
    const mock = installFetchMock(() => {
      throw new Error("the timeline must not be requested on open");
    });
    const html = view({ kind: "league", id: "L1" });
    mock.restore();

    assert.ok(html.includes("History"));
    // The rail's slider is the tell: it is drawn only once there is a payload
    // with moves in it, which there cannot be before the press.
    assert.equal(html.includes('type="range"'), false);
    assert.equal(mock.calls.length, 0);
  });

  test("still renders the panel it wraps, untouched", () => {
    // The promise the whole arrangement is arranged around: at "now" a host is
    // exactly its children, and deferring the read must not change that.
    assert.ok(view({ kind: "league", id: "L1" }).includes("the panel"));
  });

  test("a host with nothing to ask about draws no key at all", () => {
    // A closed sheet, or one opened from somewhere with no league in hand — it
    // is the detail panel and nothing else, which is what it was before the
    // timeline existed.
    const html = view(null);
    assert.equal(html.includes("History"), false);
    assert.ok(html.includes("the panel"));
  });
});
