import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";

import { DEFAULT_LEAGUE_FILTERS } from "../../league-filters/defaults.ts";
import {
  DEFAULT_PLAYER_COLUMNS,
  PLAYER_SHARE_COLUMN_PRESETS,
  PLAYER_SHARE_METRICS,
} from "../../share-metrics.ts";
import type { PlayerShare } from "../../shares.ts";
import type { SubjectView } from "../../subject-view.ts";
import { PlayerShares } from "./player-shares.tsx";
import { SharesSheet } from "./shares-sheet.tsx";

/**
 * The browse end to end: the sheet, the well it scrolls in, and the list seated
 * inside it.
 *
 * The other file drives the list on its own; this one is the claim that the
 * *sheet* is what seats it — that opening Player Shares on a real account puts a
 * windowful of cards in the document and not the account. Everything here is a
 * static render, so nothing an effect owns is reachable: the dialog is never
 * actually opened, the focus never moves, and the scroll box is never measured.
 * What those effects *decide* is pure and lives in `dialog-open` and `pointer`,
 * tested beside themselves; what is asserted here is the other side of that seam
 * — that the markup they run against is the shape they assume.
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

const shares = (count: number): PlayerShare[] =>
  Array.from({ length: count }, (_, i) => ({
    player_id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    position: "WR",
    team: "SF",
    leagues: LEAGUES,
  }));

const view: SubjectView = {
  searched: "jkap",
  userId: "1",
  leagues: LEAGUES,
  leagueFiltered: LEAGUES,
  filtered: LEAGUES,
  filters: DEFAULT_LEAGUE_FILTERS,
  setFilters: () => {},
  subjects: { subjects: [], match: "all" },
  setSubjects: () => {},
  subjectDisplay: () => null,
  subjectsLoading: false,
};

/** The player-shares browse, over `rows`. */
function sheet(
  rows: PlayerShare[] | null,
  over: { error?: string | null } = {},
) {
  return renderToStaticMarkup(
    // The sheet's `children` is a render prop — it is handed the rows that
    // survived the field and how to pick one — so it cannot travel as
    // `createElement`'s third argument the way a subtree would.
    // eslint-disable-next-line react/no-children-prop
    createElement(SharesSheet<PlayerShare>, {
      view,
      open: true,
      onClose: () => {},
      side: "left",
      kind: "player",
      title: "Player shares",
      subject: "Player",
      loadingLabel: "Reading rosters…",
      emptyLabel: "No players rostered in these leagues yet.",
      noMatchLabel: "Nobody by that name on these rosters.",
      rows,
      leagueCount: 121,
      error: over.error ?? null,
      subjectId: (share) => share.player_id,
      metrics: PLAYER_SHARE_METRICS,
      presets: PLAYER_SHARE_COLUMN_PRESETS,
      columns: DEFAULT_PLAYER_COLUMNS,
      adp: new Map(),
      onColumnChange: () => {},
      onColumns: () => {},
      onReset: () => {},
      children: (list) =>
        createElement(PlayerShares, {
          shares: list,
          leagueCount: 121,
          adp: new Map(),
          columns: DEFAULT_PLAYER_COLUMNS,
          isSelected: () => false,
          onSelect: () => {},
        }),
    }),
  );
}

const mounted = (html: string) => (html.match(/data-index="/g) ?? []).length;

describe("opening the browse on a real account", () => {
  test("a 500-player account puts a windowful in the document", () => {
    // The regression this whole change is for. Every one of those cards used to
    // be mounted synchronously — four metric cells and two controls apiece,
    // each a gradient, a shadow and its own `backdrop-filter` — inside a dialog
    // that is itself `backdrop-blur-xl`, while the sheet lazy-loaded the ADP
    // apparatus and started two reads. Mobile WebKit answered by discarding the
    // page and reloading it.
    const html = sheet(shares(500));
    const cards = mounted(html);
    assert.ok(cards > 0, "expected the first screenful to be drawn");
    assert.ok(cards < 40, `${cards} cards mounted, expected a screenful`);
    assert.match(html, /Player 1</);
  });

  test("300 and 500 players are the same number of cards", () => {
    assert.equal(mounted(sheet(shares(300))), mounted(sheet(shares(500))));
  });

  test("the well is the scroll box, and it is what the list is windowed on", () => {
    // The seam: this element is the one thing here that exists whether or not
    // there are rows, which is why it is what the list is handed.
    const html = sheet(shares(500));
    const well = /class="(min-h-0 flex-1 overflow-y-auto[^"]*)"/.exec(html);
    assert.ok(well, "expected the sheet to keep its one scroll box");
    for (const rule of [
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "overscroll-contain",
    ]) {
      assert.ok(well[1].includes(rule), `expected the well to carry ${rule}`);
    }
    // And the spacer inside it is as long as the browse, so the scrollbar
    // describes the account rather than the window.
    assert.match(html, /<ul class="relative w-full" style="height:\d+px"/);
  });
});

describe("the sheet's own states are unchanged", () => {
  test("a first read says what it is reading and lists nothing", () => {
    const html = sheet(null);
    assert.match(html, /Reading rosters…/);
    assert.equal(mounted(html), 0);
  });

  test("a failed read with nothing to keep shows the error", () => {
    assert.match(sheet(null, { error: "boom" }), /boom/);
  });

  test("an account with no rostered players says so", () => {
    assert.match(sheet([]), /No players rostered in these leagues yet\./);
  });

  test("the bar still names the browse, the count and the way out", () => {
    const html = sheet(shares(500));
    assert.match(html, /Player shares/);
    assert.match(html, /aria-label="Search player shares"/);
    assert.match(html, /aria-label="Close"/);
    assert.match(html, /3 leagues/);
    // The columns rail, previewing against the head of the *unfiltered* list.
    assert.match(html, /500 players/);
  });

  test("the glass stays on the frame", () => {
    // What must not be traded away for the mobile fix: the sheet's own blur is
    // the one thing saying the page is still underneath. It is the rows that
    // stopped raising a blur layer each, not this.
    const html = sheet(shares(20));
    assert.match(html, /backdrop-blur-xl/);
    assert.match(html, /border-active\/25/);
  });

  test("the browse is anchored to its own edge, whole", () => {
    // Four things have to agree about which side a drawer came from, and three
    // of them are invisible in review: a panel pinned left that rounds its left
    // corners, walls its free edge on the wrong side, or slides in from the
    // right is wrong in a way only a screenshot shows. They come off one table
    // (`SIDES`), so this is the assertion that the table is what is read.
    const html = sheet(shares(20));
    // Pinned to the left edge, full height, and every margin spelled out —
    // a `<dialog>` is centred by the user agent's own `margin: auto`.
    assert.match(html, /my-0 ml-0 mr-auto h-dvh max-h-dvh/);
    // Corners and wall on the free edge only.
    assert.match(html, /rounded-r-2xl border-r/);
    assert.doesNotMatch(html, /rounded-l-2xl/);
    // And it arrives from the side it is pinned to.
    assert.match(html, /animation:drawer-in-left/);
  });

  test("the leagues page is still there beside it", () => {
    // The whole reason for the shape: the browse commits live, so the list it
    // narrows has to be on screen while a row is pressed. A width that filled
    // the viewport would put this back where it started.
    const html = sheet(shares(20));
    assert.match(html, /w-\[min\(46rem,calc\(100vw-2\.5rem\)\)\]/);
  });
});

describe("where the focus can land", () => {
  test("the panel is focusable without being a tab stop", () => {
    // On a coarse pointer the focus goes here rather than into the field:
    // focusing a text input *is* raising the software keyboard, over a drawer
    // the height of the screen and the list the reader came to scroll.
    // `tabIndex={-1}` is what makes it a place to put the focus and not a stop
    // in the order — the first Tab still lands on the first control, and Escape
    // still belongs to the dialog. Which of the two is chosen is
    // `hasFinePointer`'s, tested beside itself.
    const html = sheet(shares(20));
    const panel =
      /<div tabindex="-1" class="shares-drawer-panel flex h-full flex-col[^"]*"/.exec(
        html,
      );
    assert.ok(panel, "expected the sheet's panel to be a focus target");
    // And the field is still there to be focused on a mouse, and to be tapped.
    assert.match(html, /aria-label="Search player shares"/);
  });

  test("the dialog is labelled by its own title", () => {
    const html = sheet(shares(20));
    const labelled = /aria-labelledby="([^"]+)"/.exec(html);
    assert.ok(labelled);
    assert.match(html, new RegExp(`id="${labelled[1]}"[^>]*>Player shares<`));
  });
});
