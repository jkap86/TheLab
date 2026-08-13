import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createQueryClient } from "../../query-client.ts";
import { LeagueSyncKey } from "./sync-key.tsx";

/**
 * What the panel's sync key promises before anything has been pressed.
 *
 * The rule it is easiest to break by "simplifying" is the material one: this app
 * pairs raised with "press me" and recessed with "you are here", so a key that
 * arrived as a channel or a well would be a control that looks like a readout on
 * a band whose other occupant is a tab strip built on exactly that pairing.
 *
 * The rest is the announcement. A refresh is something the reader asked for and
 * is watching, so it is reported politely and the abbreviated note beside it is
 * hidden — get either wrong and a screen reader either says nothing at all or
 * interrupts with the same sentence twice, neither of which is visible here.
 */

const key = () =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: createQueryClient() },
      createElement(LeagueSyncKey, { leagueId: "123456789" }),
    ),
  );

describe("the league sync key", () => {
  test("it is a raised pill, never a channel or a well", () => {
    // The app bar's grammar at this size: raised is what a control you press
    // wears, and the two parts it sits beside (the tab strip, the panel's
    // troughs) are recessed precisely because they are not this.
    const html = key();
    assert.match(html, /class="[^"]*lab-chip lab-chip-sm/);
    assert.doesNotMatch(html, /lab-channel|lab-well|lab-trough/);
  });

  test("it is never lit", () => {
    // `.lab-chip-on` belongs to a control that is *narrowing* something. This
    // narrows nothing, so a lit state here would spend the accent on a key that
    // has no on position to be in.
    assert.doesNotMatch(key(), /lab-chip-on/);
  });

  test("it is a live button at rest, not one waiting on something", () => {
    const html = key();
    assert.match(html, /<button[^>]*type="button"/);
    // The *attribute*, not the word: the key carries a `disabled:opacity-60`
    // variant in its class list, so a looser probe passes for a key that is
    // permanently dead and fails for one that is merely styled for the state.
    assert.doesNotMatch(html, /disabled=""/);
    assert.match(html, />Sync</);
  });

  test("nothing has been pressed, so nothing is announced and nothing is noted", () => {
    const html = key();
    // The region is present and empty: mounting it with the first answer would
    // be a region a screen reader has never seen, which is the one way a polite
    // live region reliably says nothing at all.
    assert.match(html, /role="status"/);
    assert.doesNotMatch(html, /aria-hidden="true"[^>]*>[A-Za-z]/);
  });

  test("it reports politely — a press the reader is watching is not an alert", () => {
    assert.doesNotMatch(key(), /role="alert"|aria-live="assertive"/);
  });

  test("the turning mark is motion-safe, so the word survives the reduction", () => {
    // Under `prefers-reduced-motion` what is left has to be the *status*, which
    // is the label; a spin cancelled with no word beside it is a key that never
    // reports it is working. The mark is static until a press, so the variant is
    // what this pins rather than the class being present now.
    assert.doesNotMatch(key(), /(?<!motion-safe:)animate-spin/);
  });
});
