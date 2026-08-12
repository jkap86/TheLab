import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { timelineStop } from "../timeline.ts";
import type { TradeTimelinePayload } from "@/shared/contract";
import type { PlayerSummary } from "@/shared/players";

import { TimelineRail } from "./timeline-rail.tsx";

/**
 * The rail's own markup, which is where two things live that no other test can
 * reach.
 *
 * **The slider is inverted and the state is not.** The sheet holds a count *back*
 * from now, because that is the only spelling that means something before the
 * payload lands; the rail runs left-to-right in time, so its `value` is
 * `moves - back`. That inversion has no home but this component, it is one
 * subtraction, and getting it backwards produces a rail that works perfectly in
 * reverse — which typechecks, renders, and is wrong in the one way a reader would
 * find maddening. Both ends are pinned below.
 *
 * **And which keys are dead at which end.** A step key that can do nothing is
 * drawn flat rather than merely dimmed, the rule the filters' quick-adds keep: on
 * this page's grammar a raised part is a press, so a part that looks pressable and
 * isn't is worse than one that says so.
 */

const players: Record<string, PlayerSummary> = {
  a: { player_id: "a", name: "Puka Nacua", position: "WR", team: "LAR" },
};

/** Three moves, so the rail has four stops: now, two afters, and the trade. */
const payload: TradeTimelinePayload = {
  transaction_id: "t1",
  timeline: {
    league_id: "L",
    traded_at: 100,
    rosters: [],
    events: [
      {
        transaction_id: "w2",
        type: "waiver",
        at: 1_780_000_000_000,
        roster_ids: [2],
        adds: { a: 2 },
        drops: {},
        draft_picks: [],
      },
      {
        transaction_id: "w1",
        type: "free_agent",
        at: 1_770_000_000_000,
        roster_ids: [1],
        adds: {},
        drops: {},
        draft_picks: [],
      },
      {
        transaction_id: "t1",
        type: "trade",
        at: 1_760_000_000_000,
        roster_ids: [1, 2],
        adds: { a: 1 },
        drops: { a: 2 },
        draft_picks: [],
      },
    ],
  },
  players,
  managers: {},
};

const MOVES = payload.timeline!.events.length;

function rail(back: number): string {
  return renderToStaticMarkup(
    createElement(TimelineRail, {
      stop: timelineStop(payload, back),
      moves: MOVES,
      players,
      onChange: () => {},
    }),
  );
}

/** The slider's rendered `value`, which is the whole of the inversion. */
function sliderValue(html: string): string | null {
  return /type="range"[^>]*\bvalue="(\d+)"/.exec(html)?.[1] ?? null;
}

describe("the timeline rail's position", () => {
  test("now is the right-hand end of the slider", () => {
    // `back` of 0 is the present, and the present is the newest thing on a rail
    // that runs left-to-right in time — so it is `moves`, not 0.
    assert.equal(sliderValue(rail(0)), String(MOVES));
  });

  test("the trade is the left-hand end", () => {
    assert.equal(sliderValue(rail(MOVES)), "0");
  });

  test("a stop in between lands the same distance from each end", () => {
    assert.equal(sliderValue(rail(1)), String(MOVES - 1));
  });

  test("the present is named rather than dated", () => {
    // Dating it would be labelling today by whichever move happened to be last,
    // which is a fact about the league and not about where the reader is.
    const html = rail(0);
    assert.match(html, /class="lab-readout[^"]*">Now</);
    assert.match(html, /as they stand today/);
  });

  test("a past stop wears the card's own instant grammar", () => {
    // The date in a cut and the clock time engraved beside it, so the rail reads
    // as the same instrument as the card the reader pressed to get here.
    const html = rail(1);
    assert.match(html, /class="lab-readout[^"]*">[A-Z][a-z]{2} \d{1,2}, \d{4}</);
    assert.match(html, /class="lab-engraved[^"]*">\d{1,2}:\d{2} (AM|PM)</);
  });

  test("a middle stop names the move that produced it, and who it touched", () => {
    // One back undoes the newest move, so what is left standing is `w1` — and its
    // Sleeper machine word is spelled out rather than printed raw.
    assert.match(rail(1), /after free agent/);
    // Two back leaves the trade itself standing, which named a player. Note the
    // newest move is never a *middle* stop's label: undoing nothing is "now", so
    // `w2` labels no stop at all, which is why the most recent move is the one
    // this rail never names.
    assert.match(rail(2), /after trade · Puka Nacua/);
  });

  test("the far end says what it is rather than naming the trade as a move", () => {
    // It is the one stop whose move is *not* part of it.
    assert.match(rail(MOVES), /before this trade/);
  });
});

describe("the timeline rail's keys", () => {
  test("at now, only the step into the past is live", () => {
    const html = rail(0);
    assert.match(html, /aria-label="One move earlier"(?![^>]*disabled)/);
    assert.match(html, /aria-label="One move later"[^>]*disabled/);
  });

  test("at the trade, only the step towards the present is live", () => {
    const html = rail(MOVES);
    assert.match(html, /aria-label="One move earlier"[^>]*disabled/);
    assert.match(html, /aria-label="One move later"(?![^>]*disabled)/);
  });

  test("a dead step key is drawn flat, not as a dimmed control", () => {
    // The app bar's grammar: raised means press me. A key that does nothing must
    // lose its wall rather than only its contrast.
    const html = rail(0);
    const later = /<button[^>]*aria-label="One move later"[^>]*>/.exec(html)![0];
    assert.ok(!later.includes("lab-chip"));
    const earlier = /<button[^>]*aria-label="One move earlier"[^>]*>/.exec(html)![0];
    assert.ok(earlier.includes("lab-chip"));
  });

  test("the end key the rail is standing on is lit, and the other is not", () => {
    // `aria-pressed` and the lit class are one state, so a reader and a screen
    // reader cannot be told different things about where the rail is.
    const atNow = rail(0);
    assert.match(atNow, /aria-pressed="true"[^>]*lab-chip-on[^>]*>Now</);
    assert.match(atNow, /aria-pressed="false"[^>]*>Trade</);

    const atTrade = rail(MOVES);
    assert.match(atTrade, /aria-pressed="true"[^>]*lab-chip-on[^>]*>Trade</);
    assert.match(atTrade, /aria-pressed="false"[^>]*>Now</);
  });
});
