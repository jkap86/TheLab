import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Virtualizer } from "@tanstack/virtual-core";

import type { ManagerLeague } from "@/shared/manager";

import type { PlayerShare } from "../../shares.ts";
import type { LeaguemateShare } from "../../leaguemates.ts";
import {
  LEAGUEMATE_SHARE_METRICS,
  PLAYER_SHARE_METRICS,
} from "../../share-metrics.ts";
import { LeaguemateShares } from "./leaguemate-shares.tsx";
import { PlayerShares } from "./player-shares.tsx";
import { ShareList } from "./share-list.tsx";
import {
  SHARE_LIST_INITIAL_RECT,
  SHARE_ROW_ESTIMATE,
  SHARE_ROW_GAP,
  SHARE_ROW_OVERSCAN,
  shareWindowOptions,
} from "./share-window.ts";
import { SharesScrollProvider } from "./shares-scroll.tsx";

/**
 * The shares browse, windowed.
 *
 * **What this file is a regression test for.** A manager with a hundred-odd
 * leagues rosters several hundred distinct players, and opening Player Shares
 * mounted a `ShareCard` for every one of them at once — four metric cells, two
 * controls, a gradient, a shadow and a `backdrop-filter` apiece — inside a
 * `<dialog>` that is itself `backdrop-blur-xl`, while the sheet also lazy-loaded
 * the ADP apparatus and started two reads. On mobile WebKit that is hundreds of
 * independently composited blur layers raised in one frame, and the browser's
 * answer was to discard the page and reload it.
 *
 * Two techniques, and the split between them is the honest limit of what can be
 * checked with no DOM. `renderToStaticMarkup` answers **what is mounted** —
 * React runs on the server, and a virtualizer given an `initialRect` computes a
 * real range there, which is exactly the number this fix is about. What a static
 * render cannot do is *scroll*, or fire a `ResizeObserver`; so the second half
 * drives a real `Virtualizer` from `@tanstack/virtual-core` against the very
 * options the component builds ({@link shareWindowOptions}) and moves its offset
 * and its measurements by hand. That is not a parallel implementation of the
 * rules — it is the same object, asked questions the server render cannot pose.
 */

const league = (id: string): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: { wins: 5, losses: 3, ties: 0 },
  settings: { type: 2 },
  roster_positions: ["QB", "RB", "WR", "TE", "BN"],
  scoring_settings: { rec: 1 },
});

const LEAGUES = [league("a"), league("b"), league("c")];

/** A rostered account the size the crash was reported at. */
const players = (count: number): PlayerShare[] =>
  Array.from({ length: count }, (_, i) => ({
    player_id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    position: "WR",
    team: "SF",
    leagues: LEAGUES,
  }));

const mates = (count: number): LeaguemateShare[] =>
  Array.from({ length: count }, (_, i) => ({
    user_id: `u${i + 1}`,
    name: `Mate ${i + 1}`,
    avatar_url: null,
    leagues: LEAGUES,
  }));

/** A ref standing in for the sheet's well — never dereferenced by a server render. */
const wellRef = { current: null as HTMLElement | null };

/** The list as the sheet seats it: inside a scroll box, therefore windowed. */
function windowed(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(SharesScrollProvider, { value: wellRef }, node),
  );
}

/** The list as a manager tab seats it: no box, therefore whole. */
function plain(node: ReactNode): string {
  return renderToStaticMarkup(createElement("div", null, node));
}

const playerList = (rows: PlayerShare[]) =>
  createElement(PlayerShares, {
    shares: rows,
    leagueCount: 121,
    adp: new Map(),
    columns: PLAYER_SHARE_METRICS.slice(0, 4).map((m) => m.key),
    isSelected: () => false,
    onSelect: () => {},
  });

const mateList = (rows: LeaguemateShare[]) =>
  createElement(LeaguemateShares, {
    mates: rows,
    leagueCount: 121,
    columns: LEAGUEMATE_SHARE_METRICS.slice(0, 4).map((m) => m.key),
    isSelected: () => false,
    onSelect: () => {},
  });

/** Every mounted card, as the facts that place it. */
function cards(html: string) {
  return [...html.matchAll(/<li [^>]*>/g)]
    .filter((tag) => tag[0].includes("data-index"))
    .map((tag) => {
      const read = (pattern: RegExp) => pattern.exec(tag[0])?.[1] ?? null;
      return {
        index: Number(read(/data-index="(\d+)"/)),
        rank: Number(read(/aria-posinset="(\d+)"/)),
        size: Number(read(/aria-setsize="(\d+)"/)),
        top: Number(read(/top:\s*([\d.]+)px/)),
      };
    });
}

/** The names a render actually put on screen, in order. */
function names(html: string): string[] {
  return [...html.matchAll(/tracking-tight">([^<]+)</g)].map((m) => m[1]);
}

/** How many rows a screenful plus the overscan can honestly come to. */
const CEILING =
  Math.ceil(
    SHARE_LIST_INITIAL_RECT.height / (SHARE_ROW_ESTIMATE + SHARE_ROW_GAP),
  ) +
  2 * SHARE_ROW_OVERSCAN +
  2;

describe("opening the browse mounts a window, not the account", () => {
  test("a 400-player browse mounts a screenful", () => {
    // The whole of the fix. Every one of those cards used to be in the DOM at
    // once; what is mounted now is the visible rows plus the overscan either
    // side, whatever the account holds.
    const html = windowed(playerList(players(400)));
    const rows = cards(html);
    assert.ok(rows.length > 0, "expected the first screenful to be drawn");
    assert.ok(
      rows.length <= CEILING,
      `${rows.length} cards mounted, expected at most ${CEILING}`,
    );
  });

  test("the count does not grow with the account", () => {
    // 300, 400 and 500 rows are one windowful each — the bound is what matters,
    // and that it is *independent of the list* is what makes it a bound.
    const counts = [300, 400, 500].map(
      (n) => cards(windowed(playerList(players(n)))).length,
    );
    assert.equal(
      new Set(counts).size,
      1,
      `windows differed: ${counts.join(", ")}`,
    );
    assert.ok(counts[0] < 300);
  });

  test("the leaguemates browse is windowed on the same terms", () => {
    // The abstraction is shared, so this is not a second implementation being
    // checked — it is the claim that the second view really does read it.
    const rows = cards(windowed(mateList(mates(400))));
    assert.ok(rows.length > 0 && rows.length <= CEILING);
    assert.match(windowed(mateList(mates(400))), /Mate 1</);
  });

  test("the spacer is as tall as the whole browse, so the scrollbar tells the truth", () => {
    const html = windowed(playerList(players(400)));
    const spacer = /<ul class="relative w-full" style="height:([\d.]+)px"/.exec(
      html,
    );
    assert.ok(spacer, "expected the list to be a spacer as tall as the list");
    // 400 rows at the estimate, with the gap *between* them and not after the
    // last — which is what a `gap-4` on the unwindowed list means too.
    assert.equal(
      Number(spacer[1]),
      400 * SHARE_ROW_ESTIMATE + 399 * SHARE_ROW_GAP,
    );
  });

  test("the gap between cards survives being positioned", () => {
    // The one thing absolute layout silently loses. It is the virtualizer's own
    // `gap` rather than padding inside the card, because a share card *is* its
    // `<li>` — padding for the gap would land inside the visible surface.
    const rows = cards(windowed(playerList(players(400))));
    assert.ok(rows.length > 1);
    for (const row of rows) {
      assert.equal(row.top, row.index * (SHARE_ROW_ESTIMATE + SHARE_ROW_GAP));
    }
  });

  test("a card is a real list item, and says how long the list really is", () => {
    // No `<ul><div><li>`: the card's own `<li>` takes the seat, so the list
    // keeps its semantics — and every row carries the *browse's* length rather
    // than the DOM's, or a screen reader would announce 15 players out of 15.
    const html = windowed(playerList(players(400)));
    assert.doesNotMatch(html, /<ul[^>]*>\s*<div/);
    for (const row of cards(html)) {
      assert.equal(row.size, 400);
      assert.equal(row.rank, row.index + 1);
    }
  });

  test("a manager tab still draws every row", () => {
    // The other seating, and the reason the windowing is a context rather than a
    // rewrite: with no scroll box the list is exactly what it was — no spacer,
    // no offsets, no `data-index`, and all fifty rows.
    const html = plain(playerList(players(50)));
    assert.equal((html.match(/<li /g) ?? []).length, 50);
    assert.equal(cards(html).length, 0);
    assert.match(html, /<ul class="flex w-full flex-col gap-4">/);
  });
});

describe("a row is identified by its subject, never by its position", () => {
  test("the key a virtual row is filed under is the domain id", () => {
    const rows = players(5);
    const { getItemKey } = shareWindowOptions(rows, (row) => row.player_id);
    assert.deepEqual([0, 1, 2, 3, 4].map(getItemKey), [
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
    ]);

    // And the other kind's, which is the whole reason `rowKey` is a parameter.
    const people = mates(3);
    assert.deepEqual(
      [0, 1, 2].map(shareWindowOptions(people, (m) => m.user_id).getItemKey),
      ["u1", "u2", "u3"],
    );
  });

  test("a search reshuffles the list without moving what the rows are", () => {
    // Keyed by index, everything the virtualizer remembers about a row — its
    // measured height, the element it is observing — would be handed to whoever
    // now sits at that position: an expanded card's height landing on a
    // collapsed one hundreds of rows away. Keyed by the player, a filter is just
    // a shorter list of rows it already knows.
    const all = players(400);
    const matched = all.filter((p) => p.name.startsWith("Player 3"));
    const { getItemKey } = shareWindowOptions(matched, (row) => row.player_id);
    assert.equal(getItemKey(0), matched[0].player_id);
    assert.equal(getItemKey(matched.length - 1), matched.at(-1)!.player_id);

    // And the render agrees: what is mounted is the head of what matched.
    const html = windowed(playerList(matched));
    assert.deepEqual(names(html).slice(0, 3), [
      "Player 3",
      "Player 30",
      "Player 31",
    ]);
    assert.equal(cards(html)[0].size, matched.length);
  });

  test("an index past the end of the list never throws", () => {
    // `count` and `rows` are set from one array on one render, but the
    // virtualizer holds its options across renders and can ask about an index a
    // search has since removed.
    const { getItemKey } = shareWindowOptions(
      players(2),
      (row) => row.player_id,
    );
    assert.equal(getItemKey(9), "#9");
  });
});

describe("scrolling and expanding, driven against a real virtualizer", () => {
  /**
   * A virtualizer built from the component's own options, parked at `offset`.
   *
   * Nothing is mounted and nothing is observed — the range and the offsets are
   * arithmetic over the measurement cache, which is exactly the part a static
   * render cannot exercise and the part a scroll changes.
   */
  const at = (rows: PlayerShare[], offset: number) =>
    new Virtualizer({
      ...shareWindowOptions(rows, (row) => row.player_id),
      getScrollElement: () => null,
      observeElementRect: () => {},
      observeElementOffset: () => {},
      scrollToFn: () => {},
      initialOffset: offset,
    });

  test("scrolling mounts later rows and drops earlier ones", () => {
    const rows = players(400);
    const top = at(rows, 0).getVirtualItems();
    const deep = at(
      rows,
      200 * (SHARE_ROW_ESTIMATE + SHARE_ROW_GAP),
    ).getVirtualItems();

    assert.equal(top[0].index, 0);
    assert.ok(top.length <= CEILING, "the first screenful is bounded");
    // Two hundred rows down, the window is a different — and equally small —
    // slice, and it names the players that are actually there.
    assert.ok(deep[0].index >= 200 - SHARE_ROW_OVERSCAN - 2);
    assert.ok(deep.length <= CEILING, "a deep screenful is bounded too");
    assert.equal(deep[0].key, rows[deep[0].index].player_id);
    assert.equal(
      top.filter((item) => deep.some((d) => d.key === item.key)).length,
      0,
      "the two windows should share no rows",
    );
  });

  test("expanding a card remeasures it and moves everything below it down", () => {
    // What `measureElement` buys, asked without a `ResizeObserver`: a card that
    // opens into its leagues is a resize, and the rows after it have to follow
    // it rather than overlapping it or leaving a hole.
    const rows = players(400);
    const virtualizer = at(rows, 0);
    const before = virtualizer.getVirtualItems();
    const gapBetween = (items: typeof before, i: number) =>
      items[i + 1].start - (items[i].start + items[i].size);

    assert.equal(gapBetween(before, 1), SHARE_ROW_GAP);
    const expanded = SHARE_ROW_ESTIMATE + 240;
    virtualizer.resizeItem(1, expanded);

    const after = virtualizer.getVirtualItems();
    assert.equal(
      after[1].size,
      expanded,
      "the expanded row is its real height",
    );
    // No overlap and no hole: the row after it starts exactly one gap later.
    assert.equal(gapBetween(after, 1), SHARE_ROW_GAP);
    // And everything below has moved by the difference, not by a guess.
    assert.equal(
      after[2].start - before[2].start,
      expanded - SHARE_ROW_ESTIMATE,
    );
    // The rows above are untouched, which is what keeps the scroll from jumping.
    assert.equal(after[0].start, before[0].start);
  });

  test("collapsing it again puts the list back", () => {
    const rows = players(400);
    const virtualizer = at(rows, 0);
    const before = virtualizer.getVirtualItems().map((i) => i.start);
    virtualizer.resizeItem(1, SHARE_ROW_ESTIMATE + 240);
    virtualizer.resizeItem(1, SHARE_ROW_ESTIMATE);
    assert.deepEqual(
      virtualizer.getVirtualItems().map((i) => i.start),
      before,
    );
  });

  test("a measured row keeps its height under the player it belongs to", () => {
    // The identity claim with a consequence attached: measurements are filed by
    // key, so a list that is re-ordered carries each row's height with it.
    const rows = players(10);
    const virtualizer = at(rows, 0);
    // A resize only lands once the measurements exist — the same order the
    // component reaches it in, where the ref callback fires after a render.
    virtualizer.getVirtualItems();
    virtualizer.resizeItem(3, SHARE_ROW_ESTIMATE + 100);
    const measured = virtualizer.getVirtualItems()[3];
    assert.equal(measured.key, rows[3].player_id);
    assert.equal(measured.size, SHARE_ROW_ESTIMATE + 100);
  });
});

describe("the row surface", () => {
  test("a card keeps its glass, and raises no backdrop layer on a phone", () => {
    // Hundreds of `backdrop-filter` surfaces is the other half of what mobile
    // WebKit ran out of memory over — and below `sm` the row sits on an *opaque*
    // well, so there is nothing legible behind it that the blur was softening.
    // Everything that makes the card read as glass stays at every width.
    const html = windowed(playerList(players(20)));
    assert.match(html, /sm:backdrop-blur-sm/);
    assert.doesNotMatch(html, /class="[^"]*(?<!sm:)backdrop-blur-sm/);
    for (const kept of [
      "border-foreground/10",
      "bg-gradient-to-b",
      "rounded-xl",
      "shadow-[inset_0_1px_0_rgba(255,255,255,0.08)",
    ]) {
      assert.ok(html.includes(kept), `expected the card to keep ${kept}`);
    }
  });
});

describe("what a card still does", () => {
  test("a row in the sheet is pickable, and says whether it is picked", () => {
    const rows = players(20);
    const html = windowed(
      createElement(ShareList<PlayerShare>, {
        rows,
        leagueCount: 121,
        rowKey: (row) => row.player_id,
        icon: () => null,
        note: (row) => row.team,
        metrics: PLAYER_SHARE_METRICS,
        columns: PLAYER_SHARE_METRICS.slice(0, 4).map((m) => m.key),
        isSelected: (row) => row.player_id === "p2",
        onSelect: () => {},
      }),
    );
    // The pick and the disclosure are two targets — the sheet's own rule.
    assert.match(html, /aria-label="Show the leagues holding Player 1"/);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.match(html, /aria-pressed="false"/);
  });

  test("a tab row is one target, exactly as before", () => {
    const html = plain(
      createElement(ShareList<PlayerShare>, {
        rows: players(3),
        leagueCount: 121,
        rowKey: (row) => row.player_id,
        icon: () => null,
        metrics: PLAYER_SHARE_METRICS,
        columns: PLAYER_SHARE_METRICS.slice(0, 4).map((m) => m.key),
      }),
    );
    assert.doesNotMatch(html, /aria-pressed/);
    assert.doesNotMatch(html, /aria-label="Show the leagues holding/);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
  });

  test("rows have unique keys — React would warn otherwise", () => {
    const warnings: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => warnings.push(args);
    try {
      windowed(playerList(players(400)));
      plain(mateList(mates(40)));
    } finally {
      console.error = original;
    }
    assert.deepEqual(warnings, []);
  });
});
