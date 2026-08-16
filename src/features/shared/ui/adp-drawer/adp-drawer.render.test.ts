import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ManagerLeague } from "@/shared/manager";
import type { AdpPayload, AdpPlayerPayload } from "@/shared/contract";

import {
  type AdpControls,
  DEFAULT_ADP_ROUNDS,
  defaultAdpControls,
  seedFromLeague,
} from "../../adp-controls.ts";
import { adpBoardEntries } from "../../adp-picks.ts";
import {
  type AdpSortColumn,
  DEFAULT_ADP_SORT,
  nextAdpSort,
  sortAdpEntries,
} from "../../adp-sort.ts";
import { DEFAULT_LEAGUE_FILTERS } from "../../league-filters/defaults.ts";
import { ALL_LEAGUES } from "../../league-scope.ts";
import type { AdpState } from "../../use-adp.ts";
import { AdpBay } from "./adp-bay.tsx";
import { AdpBayRail } from "./adp-bay-rail.tsx";
import { AdpBoardHeader } from "./adp-board-header.tsx";
import { AdpDrawer } from "./adp-drawer.tsx";
import { AdpDrawerFooter } from "./adp-drawer-footer.tsx";
import { AdpDrawerHeader } from "./adp-drawer-header.tsx";
import { AdpLeagueFiltersPanel } from "./adp-league-filters-panel.tsx";
import { AdpLeagueSeedControl } from "./adp-league-seed-control.tsx";
import { SteepnessSlider } from "./adp-steepness-slider.tsx";
import {
  ADP_BOARD_INITIAL_RECT,
  ADP_DRAWER_ENTER_MS,
  ADP_DRAWER_EXIT_MS,
  adpRowHeight,
  ADP_ROW_OVERSCAN,
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
  KTC_COLUMN_SEAT,
} from "./adp-drawer.constants.ts";
import {
  PICK_TAKEN_TITLE,
  ktcTitle,
  withLeagueFilters,
} from "./adp-drawer.utils.ts";

/**
 * The drawer without a DOM.
 *
 * Two techniques, and the split between them is the honest limit of what can be
 * checked here: `renderToStaticMarkup` answers what a reader *sees* (React runs
 * on the server, so this needs no browser and no dependency), and calling the
 * hook-free sections as plain functions answers what their controls *do* — a
 * React element carries its handlers as props, so a press can be made by
 * invoking one. What neither can reach is anything an effect owns: the exit
 * timer, the scroll lock, Escape and the focus move all need a document to run
 * in. What those effects *decide* was pulled out into `adp-drawer.focus` for
 * exactly that reason and is covered in `adp-drawer.focus.test.ts`; what is
 * asserted here is the other side of that seam — that the markup those rules
 * run against is the shape they assume.
 */

type Props = Record<string, unknown> & { children?: ReactNode };

/** Every element in a returned tree, depth-first. */
function elements(node: ReactNode): ReactElement<Props>[] {
  const found: ReactElement<Props>[] = [];
  const visit = (child: ReactNode) => {
    for (const next of Children.toArray(child)) {
      if (!isValidElement<Props>(next)) continue;
      found.push(next);
      visit(next.props.children);
    }
  };
  visit(node);
  return found;
}

/** The one element carrying `key={value}`, and exactly one. */
function only(node: ReactNode, key: string, value: unknown): ReactElement<Props> {
  const matches = elements(node).filter((el) => el.props[key] === value);
  assert.equal(matches.length, 1, `expected one element with ${key}=${String(value)}`);
  return matches[0];
}

/**
 * A handler off an element's props. The runtime check is what makes the cast
 * safe — element props are `unknown` and there is no narrower type available.
 */
function press(el: ReactElement<Props>, name: string): (...args: unknown[]) => void {
  const handler = el.props[name];
  assert.equal(typeof handler, "function", `expected ${name} to be a handler`);
  return handler as (...args: unknown[]) => void;
}

/**
 * A section's returned tree, for one that holds state of its own.
 *
 * Most of this file's sections are hook-free and can be called as plain
 * functions; the Leagues bay is not — it holds the draft its Apply commits. A
 * probe puts the call inside `renderToStaticMarkup`, so React's dispatcher is
 * live and the section's own `useState` binds to the probe's hook slot. That is
 * what lets its children's handlers be pressed: markup carries the options and
 * the pressed states, but not the callbacks. The same helper the league-filters
 * dialog's own render test uses, for the same reason.
 *
 * What it cannot reach is a *setter*: a state update outside a render has
 * nothing to re-render on the server, so what a press of Apply sees is the draft
 * as it was seeded. The write it makes from there is pure and pinned in
 * `adp-drawer.utils.test`.
 */
function treeOf<P>(section: (props: P) => ReactNode, props: P): ReactNode {
  let captured: ReactNode = null;
  function Probe() {
    captured = section(props);
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return captured;
}

const league = (id: string, teams: number): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2025",
  status: "in_season",
  total_rosters: teams,
  avatar: null,
  record: null,
  settings: { type: 2, best_ball: 1 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"],
  scoring_settings: { rec: 0.5 },
});

const player = (id: string, over: Partial<AdpPlayerPayload> = {}): AdpPlayerPayload => ({
  player_id: id,
  name: `Player ${id}`,
  position: "WR",
  team: "SF",
  rookie: false,
  redraft: { picks: 12, adp: Number(id) + 0.5, min_pick: 1, max_pick: 30, stdev: 2.25 },
  dynasty: { picks: 7, adp: Number(id) + 1.25, min_pick: 2, max_pick: 40, stdev: 3.5 },
  // Unpriced unless a case asks: KTC carries ~500 players, so an em dash in
  // those columns is the common row rather than the exception.
  ktc: null,
  ...over,
});

const payload = (over: Partial<AdpPayload> = {}): AdpPayload => ({
  filters: {} as AdpPayload["filters"],
  draft_count: 1204,
  redraft_drafts: 900,
  dynasty_drafts: 304,
  player_count: 5000,
  players: [player("1"), player("2"), player("3")],
  // No pick rows unless a case asks for them: the rookies are what a ladder is
  // built from and none of these players is one, so the board is players only.
  pick_ktc: {},
  ...over,
});

const loaded = (over: Partial<AdpPayload> = {}): AdpState => ({
  data: payload(over),
  error: null,
  loading: false,
  stale: false,
});

const leagues = [league("a", 12), league("b", 10)];
const density = { months: [{ season: "2026", month: "2026-05", drafts: 120 }], error: null, loading: false };

/**
 * The filter bar's props that say nothing about the filters themselves.
 *
 * The id and the trigger ref belong to the *drawer* — it is what closes the tray
 * (Escape reaches it through the lifecycle hook's document listener), so it is
 * what puts the focus back. Passing them in rather than making them here is what
 * keeps this section a plain function this file can call.
 */

function drawer(over: Partial<Parameters<typeof AdpDrawer>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(AdpDrawer, {
      open: true,
      onClose: () => {},
      controls: defaultAdpControls("2026"),
      onChange: () => {},
      onReset: () => {},
      defaultSeason: "2026",
      leagues,
      scope: ALL_LEAGUES,
      board: loaded(),
      density,
      ...over,
    }),
  );
}

describe("what is on screen", () => {
  test("an open drawer is a labelled modal dialog with a labelled way out", () => {
    const html = drawer();
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /aria-label="ADP board"/);
    // Focusable as a target for the focus move on open, but not in the tab order.
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /aria-label="Close"/);
    // The scrim is a button of its own, so a press outside dismisses.
    assert.match(html, /aria-label="Close ADP board"/);
  });

  test("a closed drawer renders nothing at all", () => {
    assert.equal(drawer({ open: false }), "");
  });

  test("the entrance plays at the documented duration", () => {
    assert.equal(ADP_DRAWER_ENTER_MS, 460);
    assert.equal(ADP_DRAWER_EXIT_MS, 340);
    const html = drawer();
    assert.match(html, new RegExp(`adp-drawer-in ${ADP_DRAWER_ENTER_MS}ms`));
    assert.match(html, new RegExp(`adp-scrim-in ${ADP_DRAWER_ENTER_MS}ms`));
  });

  test("every id is unique and every reference to one resolves", () => {
    // This used to assert the drawer carried *no* id at all, which was the
    // cheapest way to say "nothing here can collide" while nothing needed one.
    // The description does, so the rule is stated properly instead: ids come
    // from `useId` (two drawers on a page is a real state — the manager tabs and
    // the trades board each mount their own), and every ARIA reference has to
    // land on one that is actually in the markup. A literal id passes the first
    // half and is exactly what the second half of this file's siblings got wrong.
    const html = drawer();
    const ids = Array.from(html.matchAll(/ id="([^"]*)"/g), (m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, "ids must be unique");

    const referenced = Array.from(
      html.matchAll(/ aria-(?:describedby|labelledby|controls)="([^"]*)"/g),
      (m) => m[1],
    ).flatMap((value) => value.split(/\s+/));
    assert.ok(referenced.length > 0, "expected at least one ARIA reference");
    for (const target of referenced) {
      assert.ok(ids.includes(target), `aria reference ${target} resolves to nothing`);
    }
  });

  test("the drawer is described by the board's own premise", () => {
    const html = drawer();
    const id = html.match(/aria-describedby="([^"]*)"/)?.[1];
    assert.ok(id, "expected the dialog to carry a description");
    // The footer's caveat and nothing else: a board priced against an assumed
    // pool is what a reader has to hear before reading the value column.
    assert.match(
      html,
      new RegExp(`id="${id}"[^>]*>[^<]*crawled drafts, not market ADP`),
    );
  });

  test("the scrim is a pointer target and not a tab stop", () => {
    // It is a sibling of the dialog rather than a child, so a tab stop on it is
    // a stop outside the modal — and the header's own close key says the same
    // thing from inside.
    const scrim = drawer().match(/<button[^>]*aria-label="Close ADP board"[^>]*>/)?.[0];
    assert.ok(scrim, "expected the scrim to be a button");
    assert.match(scrim, /tabindex="-1"/);
  });

  test("the dialog holds tab stops, which is what the trap needs to find", () => {
    // The focus trap's own rules are checked against fakes in
    // `adp-drawer.focus.test.ts` — there is no DOM here to run them on. This is
    // the other half of that seam: the drawer really does render controls
    // matching `TABBABLE_SELECTOR`, so the trap has somewhere to send Tab
    // rather than falling through to its empty-dialog case.
    const html = drawer({ seedLeagues: leagues });
    const panel = html.slice(html.indexOf("<div role=\"dialog\""));
    // Buttons and nothing else, at rest: the `<select>` and the two `<input>`s
    // this used to look for are a bay's contents now, so they are behind a
    // press. That they are real stops once a bay is up is asserted where a bay
    // can actually be mounted — see "a bay's contents are real controls".
    assert.ok(panel.includes("<button"), "the dialog should render a <button> tab stop");
    // And the dialog itself is not one of them: `tabindex="-1"` is on the same
    // element as `role="dialog"`, so the focus move on open lands somewhere the
    // trap reads as "not on a stop" and the first Tab goes to the first control.
    const openingTag = panel.slice(0, panel.indexOf(">"));
    assert.match(openingTag, /tabindex="-1"/);
    assert.match(openingTag, /adp-drawer-panel/);
  });

  test("the rail states what every bay is set to, and opens none of them", () => {
    // The reversal of the rule this test used to hold, and the terms it was
    // reversed on. The window really is behind a press again — but what the
    // press opens is an *instrument*, and what the key in front of it carries is
    // the board's own label plus a picture of the density behind it, which is
    // the fact the old collapsed trigger hid behind a row of presets. A shut bay
    // that named nothing would be the ledge mistake this rail exists to avoid.
    const html = drawer();
    for (const label of [">Leagues<", ">Window<", ">Curve<"]) {
      assert.ok(html.includes(label), `expected a ${label} key on the rail`);
    }
    // Each key's value, in the board's own words — `adpBayStates`' job, and the
    // reason it is pure and tested beside this. The window is the fortnight the
    // board opens on, named rather than left to be inferred from a season.
    assert.match(html, /2026 · Last 14 days/);
    assert.match(html, /% of the 1\.01/);
    // Every key shut, and therefore every bay's contents absent.
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
    assert.doesNotMatch(html, /aria-expanded="true"/);
    for (const inside of [
      /aria-label="Days back/,
      /aria-label="Window ends"/,
      /aria-label="Value curve steepness"/,
      /Match a league/,
    ]) {
      assert.doesNotMatch(html, inside);
    }
    // The one piece of the window that *is* on screen shut, and the reason this
    // collapse is not the one that was reversed: the key carries the density as
    // a mark, so a reader sees where the drafts are without opening anything.
    // (It wears `lab-channel-bar-lit` without the channel around it, which is
    // why "no channel" is not the way to ask whether the bay is shut.)
    assert.match(html, /lab-channel-bar-lit/);
  });

  test("no preset chip states a window the lenses already state", () => {
    // "Last 30 days" is `30` in the day lens and "All of 2026" is that lens left
    // empty (which the board no longer opens on — the default is a fortnight, so
    // the lens opens carrying 14), so a chip row beside an open counter is two
    // controls for one selection. What survives inside the panel is the keys that are *not* fixed
    // windows — `Today`, which re-opens the end, and the ◆ draft key, which pins
    // a date that moves every April (drawn only when the strip's domain holds a
    // draft, which this fixture's single May month does not; `lookback.test.ts`
    // is where that resolution is checked).
    const html = drawer();
    for (const chip of [">30 days<", ">90 days<", ">12 mo<", ">All 2026<", ">All time<"]) {
      assert.ok(!html.includes(chip), `expected no ${chip} preset chip`);
    }
    // `Today` and the ◆ draft key live inside the window bay, which is behind a
    // press — see the bay tests below, where one can be mounted.
    // The board's own name is stated once, by the Window key. Opening that bay
    // adds the counter's caption, which is the same label a second time and is
    // why the key and the caption have to keep agreeing: both read `boardLabel`.
    assert.equal((html.match(/2026 · Last 14 days/g) ?? []).length, 1);
  });

  test("every control keeps an accessible name", () => {
    // At rest that is the rail's own keys and the identity line; the bays'
    // controls are checked in "a bay's contents are real controls", where they
    // can be mounted.
    const html = drawer({ seedLeagues: leagues });
    assert.match(html, /aria-label="Close"/);
    assert.match(html, /aria-label="Close ADP board"/);
    assert.equal((html.match(/aria-expanded=/g) ?? []).length, 3);
  });
});

describe("the bays", () => {
  const controls = defaultAdpControls("2026");
  const railProps = {
    controls,
    months: [],
    open: null as "leagues" | "window" | "curve" | null,
    bayId: "bay",
    openKeyRef: { current: null },
    onToggle: () => {},
  };

  test("a shut rail is three raised keys and no panel", () => {
    const html = renderToStaticMarkup(AdpBayRail(railProps));
    assert.equal((html.match(/lab-chip lab-chip-sm/g) ?? []).length, 3);
    assert.doesNotMatch(html, /lab-well/);
    // Nothing controls anything while nothing is open: an `aria-controls`
    // pointing at an id that is not in the document is a reference resolving to
    // nothing, which the markup test above forbids across the whole drawer.
    assert.doesNotMatch(html, /aria-controls/);
  });

  test("the open key sinks into the rail and controls the bay", () => {
    // Sunk means open — the app bar's grammar, and what says which key a
    // floating panel came from. It is deliberately *not* the accent, which is
    // spent on "narrowed" and would otherwise have to carry both.
    const html = renderToStaticMarkup(AdpBayRail({ ...railProps, open: "window" as const }));
    assert.equal((html.match(/lab-well/g) ?? []).length, 1);
    assert.equal((html.match(/lab-chip lab-chip-sm/g) ?? []).length, 2);
    assert.match(html, /aria-controls="bay"/);
    assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  });

  test("the accent says narrowed, never open", () => {
    // A default board: the Window key is open and still not accented, because
    // it is not cutting anything. Narrow the range and it lights while shut.
    const open = renderToStaticMarkup(AdpBayRail({ ...railProps, open: "window" as const }));
    assert.doesNotMatch(open, /text-active">All of 2026/);

    const narrowed = renderToStaticMarkup(
      AdpBayRail({
        ...railProps,
        controls: {
          ...controls,
          range: { preset: "30d" as const, from: null, to: null },
        },
      }),
    );
    assert.match(narrowed, /text-active">2026 · Last 30 days/);
  });

  test("the Window key carries the density it is cut from", () => {
    // The one thing that makes a shut window bay more than a label: the reader
    // can see where the drafts are without opening anything.
    const withDensity = renderToStaticMarkup(
      AdpBayRail({
        ...railProps,
        months: [
          { season: "2026", month: "2026-04", drafts: 10 },
          { season: "2026", month: "2026-05", drafts: 40 },
        ],
      }),
    );
    assert.equal((withDensity.match(/lab-channel-bar-lit/g) ?? []).length, 2);
    // And a season with nothing crawled draws no bars rather than an empty slot.
    assert.doesNotMatch(
      renderToStaticMarkup(AdpBayRail(railProps)),
      /lab-channel-bar-lit/,
    );
  });

  test("a bay is a labelled group, not a dialog", () => {
    // Deliberately not a `<dialog>`: a modal one makes the board behind it
    // inert, and the board is the thing a bay exists to be watched against.
    const html = renderToStaticMarkup(
      AdpBay({
        id: "bay",
        bay: "curve" as const,
        label: "Value curve",
        children: createElement("span", null, "x"),
      }),
    );
    assert.match(html, /role="group"/);
    assert.match(html, /aria-label="Value curve"/);
    assert.match(html, /id="bay"/);
    assert.doesNotMatch(html, /<dialog/);
  });

  test("a bay's contents are real controls, with their names", () => {
    // What the drawer mounts inside each bay. The mapping from key to content is
    // the composition root's and needs a press to reach, which this file cannot
    // make — the same seam as the effects, and the reason `adp-drawer.focus` is
    // tested separately. What is checked here is the other half: each of the
    // three really is a control with a name, so a bay is somewhere Tab can land.
    const filters = renderToStaticMarkup(
      createElement(AdpLeagueFiltersPanel, {
        controls,
        leagues,
        seedLeagues: leagues,
        onChange: () => {},
        onApplied: () => {},
      }),
    );
    assert.match(filters, /Match a league…/);
    // And the filters themselves, inline rather than behind a second press:
    // the rule bays and the readout the shared panel draws, in the bay.
    assert.match(filters, /Any scoring\. Add a rule to narrow by what a league pays\./);
    assert.match(filters, /Leagues matching/);

    const curve = renderToStaticMarkup(
      SteepnessSlider({
        value: controls.steepness,
        onPreview: () => {},
        onCommit: () => {},
      }),
    );
    assert.match(curve, /aria-label="Value curve steepness"/);
  });
});

describe("the board's states", () => {
  test("a failed read says so and draws no list", () => {
    const html = drawer({ board: { data: null, error: "boom", loading: false, stale: false } });
    assert.match(html, /ADP unavailable — boom/);
    assert.doesNotMatch(html, /<ul>/);
  });

  test("a first load says it is loading", () => {
    const html = drawer({ board: { data: null, error: null, loading: true, stale: false } });
    assert.match(html, /Loading the board…/);
  });

  test("an empty board says the filters matched nothing", () => {
    const html = drawer({ board: { data: null, error: null, loading: false, stale: false } });
    assert.match(html, /No crawled drafts match these filters\./);
  });

  test("a populated board lists every row, ranked as displayed", () => {
    const html = drawer();
    assert.equal((html.match(/<li /g) ?? []).length, 3);
    assert.match(html, /Player 1/);
    assert.match(html, /Player 3/);
    // Ranks are the display's own numbering, not the fetch's order.
    const ranks = [...html.matchAll(/tabular-nums text-foreground\/35">(\d+)</g)].map(
      (m) => m[1],
    );
    assert.deepEqual(ranks.slice(0, 3), ["1", "2", "3"]);
  });

  test("rows have unique keys — React would warn otherwise", () => {
    const warnings: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => warnings.push(args);
    try {
      drawer();
    } finally {
      console.error = original;
    }
    assert.deepEqual(warnings, []);
  });

  test("data already in hand stays on screen while the next board loads", () => {
    // The client cache's `keepPreviousData` rule, seen from the drawer: a
    // refetch must not blank three hundred rows to an em dash and back.
    const html = drawer({ board: { ...loaded(), loading: true } });
    assert.equal((html.match(/<li /g) ?? []).length, 3);
    assert.doesNotMatch(html, /Loading the board…/);
  });

  test("held rows from the previous filter set are dimmed and say so", () => {
    // The other half of that rule: rows held through a *filter change* belong
    // to the board on its way out, so passing them off undimmed as the new
    // selection's answer is the one dishonest state `keepPreviousData` can
    // produce. The rows stay mounted and readable — no flash, no empty state —
    // dimmed, marked busy, with the sticky head saying "Updating" in words and
    // the header's count (the number the press was made to move) dimmed too.
    const html = drawer({ board: { ...loaded(), loading: true, stale: true } });
    assert.equal((html.match(/<li /g) ?? []).length, 3, "the rows stay on screen");
    assert.doesNotMatch(html, /Loading the board…/);
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /opacity-40/);
    assert.match(html, /role="status"[^>]*>Updating…</);
  });

  test("a background refetch of the same board dims nothing", () => {
    // `loading` without `stale` is a fresh copy of the *same* answer on its
    // way — the rows on screen are right, so nothing may dim or announce.
    const html = drawer({ board: { ...loaded(), loading: true } });
    assert.doesNotMatch(html, /aria-busy/);
    assert.doesNotMatch(html, /opacity-40/);
    assert.doesNotMatch(html, /Updating…/);
  });

  test("a board with drafts but nothing on the shown market says which", () => {
    const controls: AdpControls = { ...defaultAdpControls("2026"), boards: "dynasty" };
    const html = drawer({
      controls,
      board: loaded({ players: [player("1", { dynasty: null })] }),
    });
    assert.match(html, /Nothing on the dynasty board for these filters\./);
  });

  test("the tail past the page says how much of the population it is", () => {
    assert.match(drawer(), /Showing 3 of 5,000 players matching these filters\./);
    const whole = drawer({ board: loaded({ player_count: 3 }) });
    assert.doesNotMatch(whole, /Showing/);
  });
});

describe("the board is windowed", () => {
  /** A board the size the endpoint can actually answer with. */
  const bigBoard = (count: number) =>
    loaded({ players: Array.from({ length: count }, (_, i) => player(String(i + 1))) });

  /**
   * Every mounted row, as the facts that place it. Read attribute by attribute
   * rather than as one pattern over the whole tag, so reordering the props on
   * the element doesn't fail this for a reason nobody can see.
   */
  const mounted = (html: string) =>
    [...html.matchAll(/<li [^>]*>/g)].map((tag) => {
      const read = (pattern: RegExp) => Number(pattern.exec(tag[0])?.[1] ?? NaN);
      return {
        size: read(/aria-setsize="(\d+)"/),
        rank: read(/aria-posinset="(\d+)"/),
        height: read(/height:\s*([\d.]+)px/),
        offset: read(/translateY\((-?[\d.]+)px\)/),
      };
    });

  test("a thousand-row board mounts a window, not a thousand rows", () => {
    // The whole of the fix. `/api/adp` answers up to `limit=1000`, and every one
    // of those was a six-column grid in the DOM at once — which is what made
    // scrolling the panel feel stuck. What is mounted now is the visible rows
    // plus the overscan either side, whatever the board's length.
    const html = drawer({ board: bigBoard(1000) });
    const rows = mounted(html);
    assert.equal(rows.length, (html.match(/<li /g) ?? []).length);
    assert.ok(rows.length > 0, "expected the first screenful to be drawn");
    // A screenful of `ADP_BOARD_INITIAL_RECT` plus one overscan at each end,
    // which is nowhere near a thousand — the bound is what matters, not the
    // exact count.
    const ceiling = Math.ceil(ADP_BOARD_INITIAL_RECT.height / adpRowHeight()) + 2 * ADP_ROW_OVERSCAN + 2;
    assert.ok(rows.length <= ceiling, `${rows.length} rows mounted, expected at most ${ceiling}`);
    // And the count does not grow with the board: ten times the rows, the same
    // windowful.
    assert.equal(mounted(drawer({ board: bigBoard(100) })).length, rows.length);
  });

  test("the spacer is as tall as the whole list, so the scrollbar tells the truth", () => {
    const html = drawer({ board: bigBoard(1000) });
    const spacer = html.match(/<ul[^>]*style="height:(\d+)px"/)?.[1];
    assert.equal(Number(spacer), 1000 * adpRowHeight());
  });

  test("a row is exactly the height the offsets are multiples of", () => {
    // `adpRowHeight()` is written onto the element rather than estimated from
    // it, which is what makes fixed-size windowing safe: an estimate a pixel out
    // is a screen of drift a thousand rows down.
    const rows = mounted(drawer({ board: bigBoard(200) }));
    assert.ok(rows.length > 1);
    for (const row of rows) {
      assert.equal(row.height, adpRowHeight());
      assert.equal(row.offset, (row.rank - 1) * adpRowHeight());
    }
  });

  test("a rank is the row's place in the whole list, not in the window", () => {
    // The invariant that would break if the visible rows were numbered from one:
    // every mounted row's rank is its own offset's row index, and the set size
    // every row reports is the board's length rather than the DOM's.
    const html = drawer({ board: bigBoard(400) });
    const rows = mounted(html);
    assert.ok(rows.length < 400);
    for (const row of rows) {
      assert.equal(row.size, 400);
      assert.equal(row.rank, row.offset / adpRowHeight() + 1);
    }
    assert.equal(rows[0].rank, 1);
    assert.equal(rows[rows.length - 1].rank, rows.length);
  });

  test("the scroll box is bounded, contained, and keeps its gutter", () => {
    const html = drawer();
    const box = html.match(/class="min-h-0[^"]*"/)?.[0];
    assert.ok(box, "expected the board to be the drawer's one scroll box");
    // `min-h-0` is the one that fixes the scrolling: a flex child's automatic
    // minimum is its own content, so without it the box grew past the panel and
    // its `overflow-y-auto` had nothing left to scroll.
    for (const rule of [
      "min-h-0",
      "flex-1",
      "overflow-y-auto",
      "overscroll-contain",
      "[scrollbar-gutter:stable]",
    ]) {
      assert.ok(box.includes(rule), `expected the scroll box to carry ${rule}`);
    }
  });

  test("the sticky head sits above the spacer, not inside it", () => {
    // Virtualising must not cost the column labels: they are what a column of
    // bare numbers three hundred rows down is read against, so the head stays a
    // sibling *before* the positioned rows — inside the spacer it would be
    // absolutely positioned along with them and stop sticking.
    const html = drawer({ board: bigBoard(200) });
    const head = html.indexOf("sticky top-0 z-10");
    const list = html.indexOf("<ul");
    assert.ok(head !== -1 && list !== -1);
    assert.ok(head < list, "the board head should precede the list");
    assert.ok(!html.slice(list).includes("sticky top-0 z-10"));
  });
});

describe("picks on the board", () => {
  /**
   * Twelve rookies, so a twelve-team round of numbered picks has a rung each and
   * the middle of a round — where a future pick is assumed to fall — is the
   * sixth of them.
   */
  const rookies = Array.from({ length: 12 }, (_, i) =>
    player(`r${i + 1}`, {
      rookie: true,
      redraft: { picks: 9, adp: i + 1, min_pick: 1, max_pick: 30, stdev: 2 },
      dynasty: { picks: 9, adp: i + 1, min_pick: 1, max_pick: 30, stdev: 2 },
    }),
  );
  const withPicks = (over: Partial<AdpPayload> = {}) =>
    loaded({
      players: rookies,
      pick_ktc: {
        "2027|1|": { sf: 6000, oneqb: 5400 },
        "2027|2|": { sf: 2000, oneqb: 1800 },
        "2028|1|": { sf: 3000, oneqb: 2700 },
      },
      ...over,
    });

  test("the class is numbered slot by slot and the seasons past it by round", () => {
    const html = drawer({ board: withPicks() });
    assert.match(html, /2026 1\.01/);
    assert.match(html, /2026 1\.12/);
    // A future season has no class to number against, so it is one row per
    // round, assumed mid — and named for the round rather than given a slot.
    assert.match(html, /2027 1st/);
    assert.match(html, /2028 1st/);
    // Its rung would be the eighteenth rookie and this board averaged twelve:
    // inventing one would price a pick against a player nobody drafted.
    assert.doesNotMatch(html, /2027 2nd/);
  });

  test("a pick sits with the rookie it stands on, one row below", () => {
    // The tie rule, and the whole reason a pick's ADP is the rung's own average:
    // the two carry the same number for the same reason, so the pick reads as an
    // annotation of the player above it.
    const html = drawer({ board: withPicks() });
    assert.ok(html.indexOf("Player r1") < html.indexOf("2026 1.01"));
    assert.ok(html.indexOf("2026 1.01") < html.indexOf("Player r2"));
  });

  test("the position column carries the round, since a pick has no position", () => {
    const html = drawer({ board: withPicks() });
    const row = html.slice(html.indexOf("2026 1.01"));
    assert.match(row.slice(0, 400), />1st</);
  });

  test("a pick's Taken cell is an em dash that says why", () => {
    // "Taken" is the share of this board's drafts a player went in, and a pick
    // went in none of them — it was never on the board. A bare em dash there
    // would read as a gap in the data rather than as a column that can't apply.
    const html = drawer({
      board: withPicks(),
      controls: { ...defaultAdpControls("2026"), boards: "redraft" },
    });
    assert.ok(html.includes(PICK_TAKEN_TITLE));
  });

  test("KTC gone costs the future rows and not the numbered ones", () => {
    // The ladder *is* the current class, so its own picks need nothing from KTC
    // — and a season KTC has no opinion about is one this cannot discount, which
    // is why it is absent rather than quoted at a nearer pick's price.
    const html = drawer({ board: withPicks({ pick_ktc: {} }) });
    assert.match(html, /2026 1\.01/);
    assert.doesNotMatch(html, /2027 1st/);
  });

  test("a board with no rookies lists no picks at all", () => {
    const html = drawer({ board: withPicks({ players: [player("1"), player("2")] }) });
    assert.doesNotMatch(html, /2026 1\.01/);
    assert.doesNotMatch(html, /2027 1st/);
  });

  test("the count line still counts players, not the picks derived from them", () => {
    // The denominator only ever counts players, so a numerator carrying the
    // picks would sit above it — "showing 27 of 20" — for a list that is in fact
    // showing all twenty.
    const html = drawer({ board: withPicks({ player_count: 5000 }) });
    assert.match(html, /Showing 12 of 5,000 players/);
  });
});

describe("the column configurations", () => {
  test("both boards seat two ADP columns and drop Taken", () => {
    const html = drawer();
    assert.ok(html.includes(BOARD_COLUMNS_BOTH));
    assert.ok(!html.includes(BOARD_COLUMNS_ONE));
    assert.match(html, />ADP R</);
    assert.match(html, />ADP D</);
    assert.doesNotMatch(html, />Taken</);
  });

  test("one board keeps Taken and a single value column", () => {
    for (const boards of ["redraft", "dynasty"] as const) {
      const html = drawer({ controls: { ...defaultAdpControls("2026"), boards } });
      assert.ok(html.includes(BOARD_COLUMNS_ONE));
      assert.ok(!html.includes(BOARD_COLUMNS_BOTH));
      assert.match(html, />Taken</);
      assert.match(html, />Value</);
      assert.doesNotMatch(html, />ADP R</);
    }
  });

  test("the collapsible columns are seated behind the panel's own container queries", () => {
    // `@md` and `@lg`, which measure the drawer rather than the viewport — the
    // panel is narrower than the screen everywhere a laptop is involved.
    const html = drawer();
    assert.match(html, /hidden @md:block/);
    assert.match(html, new RegExp(KTC_COLUMN_SEAT));
  });

  test("the KTC pair is drawn whichever markets are lit, and seated as one", () => {
    // KTC publishes superflex and 1QB; this board's own two columns are redraft
    // and dynasty. Those are different axes, so the same two KTC columns are
    // right in both modes — a branch that drew them per market would be
    // claiming a per-market price KTC does not publish.
    for (const boards of ["both", "redraft", "dynasty"] as const) {
      const html = drawer({ controls: { ...defaultAdpControls("2026"), boards } });
      // `SF` and `1QB` rather than `KTC SF` / `KTC 1QB`: the longer pair does
      // not fit a 40px track once a sort caret is on it, so the source lives in
      // the hover and the accessible name. See `BOARD_COLUMNS_ONE`.
      assert.match(html, />SF</, `${boards}: expected an SF heading`);
      assert.match(html, />1QB</, `${boards}: expected a 1QB heading`);
      assert.match(html, /aria-label="KeepTradeCut superflex dynasty value/);
      assert.match(html, /aria-label="KeepTradeCut 1QB dynasty value/);
      // The heading and its cells cross the tier together, or the label is
      // sitting over the wrong numbers at some width. Two headings plus two
      // cells on each of the three player rows.
      const seated = (html.match(new RegExp(KTC_COLUMN_SEAT, "g")) ?? []).length;
      assert.equal(seated, 2 + 2 * 3, `${boards}: heading and cells must share a seat`);
    }
  });

  test("a KTC price is a number, and an unpriced player an em dash", () => {
    const html = drawer({
      board: loaded({
        players: [
          player("1", { ktc: { sf: 9412, oneqb: 8770 } }),
          // KTC carries ~500 dynasty skill players, so "no price" is the
          // ordinary state of a kicker rather than a gap in the data.
          player("2", { ktc: null }),
          // And one board priced while the other isn't is a real row too.
          player("3", { ktc: { sf: 6000, oneqb: null } }),
        ],
      }),
    });
    // Read off the KTC cells specifically rather than the whole panel: a bare
    // `>0<` matches the rolling draft counter's digit strip, which is why the
    // "never a zero" rule has to be asserted against the cells that could
    // wrongly render one.
    const priced = [...html.matchAll(/tabular-nums text-foreground\/60"[^>]*>([^<]+)</g)];
    assert.deepEqual(priced.map((m) => m[1]), ["9,412", "8,770", "6,000"]);
    // Three unpriced cells — both of player 2's, and player 3's 1QB — each an
    // em dash and never a zero.
    const blank = html.match(/hidden @lg:block text-right text-xs text-foreground\/25"?>—</g);
    assert.equal(blank?.length, 3);
  });

  test("the headings say which board KTC's number is from", () => {
    // The board's biggest caveat, and the only place there is room for it: KTC
    // scrapes a *dynasty* board, so these columns sit beside a redraft average
    // as readily as a dynasty one.
    const html = drawer({ controls: { ...defaultAdpControls("2026"), boards: "redraft" } });
    assert.ok(html.includes(ktcTitle("sf")));
    assert.ok(html.includes(ktcTitle("oneqb")));
    assert.match(html, /a dynasty board whichever ADP column it is read beside/);
  });
});

describe("the columns sort", () => {
  test("every heading is a button that names its column and its state", () => {
    const html = drawer();
    const headings = [...html.matchAll(/<button[^>]*aria-label="([^"]*activate to sort[^"]*)"/g)];
    // Nine in both-boards mode: rank, name, position, two ADP, two value, two
    // KTC. Every one of them a real control with a name — `aria-sort` is not
    // available to a list of `<li>`, so the label carries the state instead.
    assert.equal(headings.length, 9);
    // The board opens on its own merge, which is a column like any other rather
    // than a fourth "unsorted" state the header would have to draw differently.
    const sorted = headings.filter((m) => m[1].includes("sorted"));
    assert.deepEqual(sorted.map((m) => m[1]), [
      "Board order, sorted ascending — activate to sort descending",
    ]);
  });

  test("only the lit column takes the accent, and it carries a caret", () => {
    const html = drawer();
    // Sort headings only — `text-active` is the app's "this is the state that
    // matters" token and is spent elsewhere in the drawer's chrome too.
    const lit = [
      ...html.matchAll(
        /<button[^>]*aria-label="[^"]*activate to sort[^"]*"[^>]*class="([^"]*)"[^>]*>([^<]*)/g,
      ),
    ].filter((m) => m[1].includes("text-active"));
    assert.equal(lit.length, 1);
    assert.equal(lit[0][2], "#");
    // Decoration: the direction is in the accessible name, so the glyph is
    // hidden rather than read out as a character of the label.
    assert.match(html, /aria-hidden="true" class="ml-0\.5 text-\[0\.5rem\]">▲/);
  });

  test("a heading press reaches nextAdpSort, and a second press flips it", () => {
    const presses: AdpSortColumn[] = [];
    const tree = AdpBoardHeader({
      both: true,
      soleBoard: "redraft",
      soleDrafts: 900,
      redraftDrafts: 900,
      dynastyDrafts: 304,
      rules: DEFAULT_LEAGUE_FILTERS,
      sort: DEFAULT_ADP_SORT,
      onSort: (column) => presses.push(column),
    });
    const headings = elements(tree).filter(
      (el) => typeof el.props.onSort === "function" && el.props.column !== undefined,
    );
    assert.equal(headings.length, 9);
    for (const el of headings) press(el, "onSort")(el.props.column);
    assert.deepEqual(presses, [
      "rank",
      "name",
      "position",
      "adp_redraft",
      "adp_dynasty",
      "value_redraft",
      "value_dynasty",
      "ktc_sf",
      "ktc_oneqb",
    ]);
    // What each of those presses *means* is `nextAdpSort`'s, tested beside it —
    // this is only the wiring.
    assert.deepEqual(nextAdpSort(DEFAULT_ADP_SORT, "rank"), {
      column: "rank",
      direction: "desc",
    });
  });

  test("the single-board headings sort the market that is lit", () => {
    // One heading reading "ADP" is a different column depending on which board
    // is up, which is why the sort vocabulary is board-qualified rather than
    // positional.
    for (const boards of ["redraft", "dynasty"] as const) {
      const presses: AdpSortColumn[] = [];
      const tree = AdpBoardHeader({
        both: false,
        soleBoard: boards,
        soleDrafts: 900,
        redraftDrafts: 900,
        dynastyDrafts: 304,
        rules: DEFAULT_LEAGUE_FILTERS,
        sort: DEFAULT_ADP_SORT,
        onSort: (column) => presses.push(column),
      });
      const headings = elements(tree).filter((el) => el.props.column !== undefined);
      for (const el of headings) press(el, "onSort")(el.props.column);
      assert.ok(presses.includes(`adp_${boards}`));
      assert.ok(presses.includes(`value_${boards}`));
      assert.ok(presses.includes("taken"));
      // And never the market that isn't drawn.
      const other = boards === "redraft" ? "dynasty" : "redraft";
      assert.ok(!presses.includes(`adp_${other}`));
    }
  });

  test("sorting a column reorders the rows on screen", () => {
    // The board's own merge is by ADP, so a KTC sort has to produce a different
    // list — this is the end-to-end check that the sort reaches the rendered
    // rows rather than only the header's own state.
    const players = [
      player("1", { ktc: { sf: 10, oneqb: 10 } }),
      player("2", { ktc: { sf: 9000, oneqb: 9000 } }),
      player("3", { ktc: { sf: 500, oneqb: 500 } }),
    ];
    const html = drawer({ board: loaded({ players }) });
    const order = (markup: string) =>
      [...markup.matchAll(/Player (\d)/g)].map((m) => m[1]);
    assert.deepEqual(order(html), ["1", "2", "3"], "the board opens in ADP order");

    // Pressing a heading is state this static render cannot make, so the
    // ordering itself is pinned in `adp-sort.test.ts`; what is checked here is
    // that the rows the drawer renders are the sorted list and not `rows`.
    const sorted = sortAdpEntries(
      adpBoardEntries(players, [], "both"),
      { column: "ktc_sf", direction: "desc" },
      { soleBoard: "redraft", rules: DEFAULT_LEAGUE_FILTERS, steepness: 3 },
    );
    assert.deepEqual(
      sorted.map((row) => (row.kind === "player" ? row.player.player_id : row.key)),
      ["2", "3", "1"],
    );
  });
});

describe("the league seed control", () => {
  test("it is absent when the caller offers no leagues of the reader's own", () => {
    // Explicitly not a fallback to `leagues`: that population is every crawled
    // league, which is a different control rather than a longer list.
    const html = drawer({ leagues, seedLeagues: [] });
    assert.doesNotMatch(html, /Match a league…/);
    assert.equal(AdpLeagueSeedControl({ controls: defaultAdpControls("2026"), leagues: [], onChange: () => {} }), null);
  });

  test("it is drawn, and names every offered league, when there are some", () => {
    // Rendered through the Leagues bay rather than the whole drawer: the chip is
    // behind the Leagues key now, and a static render cannot press one.
    const html = renderToStaticMarkup(
      createElement(AdpLeagueFiltersPanel, {
        controls: defaultAdpControls("2026"),
        leagues,
        seedLeagues: leagues,
        onChange: () => {},
        onApplied: () => {},
      }),
    );
    assert.match(html, /Match a league…/);
    assert.match(html, /League a/);
    assert.match(html, /League b/);
  });

  test("picking one seeds through seedFromLeague", () => {
    const controls = defaultAdpControls("2026");
    let seeded: AdpControls | null = null;
    const tree = AdpLeagueSeedControl({
      controls,
      leagues,
      onChange: (next) => {
        seeded = next;
      },
    });
    press(only(tree, "ariaLabel", "Match one of this manager's leagues"), "onChange")("b");
    assert.deepEqual(seeded, seedFromLeague(controls, leagues[1]));
  });

  test("an id off the list writes nothing", () => {
    let calls = 0;
    const tree = AdpLeagueSeedControl({
      controls: defaultAdpControls("2026"),
      leagues,
      onChange: () => {
        calls += 1;
      },
    });
    press(only(tree, "ariaLabel", "Match one of this manager's leagues"), "onChange")("zzz");
    assert.equal(calls, 0);
  });
});

describe("what the controls do", () => {
  test("the Leagues bay is the shared filters panel, plus the seed chip and nothing else", () => {
    // The four chips this bay used to carry — scoring, superflex, best ball and
    // league size — are league *rules* now, and the key that used to open them
    // in a modal over the whole page is gone with them: the panel is drawn here,
    // so the board it narrows stays live behind it.
    const tree = treeOf(AdpLeagueFiltersPanel, {
      controls: defaultAdpControls("2026"),
      leagues,
      seedLeagues: leagues,
      onChange: () => {},
      onApplied: () => {},
    });
    // The bay's own children, unrendered: the seed chip (named by the leagues it
    // was handed) and the shared panel. Two parts, no trigger — the bay itself
    // is the assertion.
    const parts = elements(tree).filter((el) => typeof el.type !== "string");
    assert.equal(parts.length, 2);
    assert.equal(parts[0].type, AdpLeagueSeedControl);
    assert.deepEqual(parts[0].props.leagues, leagues);
    // Seated in the bay, which is the only thing about the panel this host
    // changes — see `PANEL_SEATS`.
    assert.equal(parts[1].props.seat, "bay");
    // Minus two rows, for one argument twice over: every fetch answers both
    // markets and the board's own keys choose which is drawn, and the pinned
    // block above leads with its own season row that decides which leagues are
    // fetched at all. Either row inside the panel would be a second control
    // over a question this page already owns.
    assert.deepEqual(parts[1].props.omit, ["season", "type"]);
  });

  test("the draft kind rides inside that panel, seeded from the controls", () => {
    // Seated in the panel's trough rather than beside it: what kind of draft to
    // average is the one thing left that a league rule cannot say, and a panel
    // plus a stray chip is the arrangement this replaced.
    const controls = { ...defaultAdpControls("2026"), rounds: "rookie" as const };
    const tree = treeOf(AdpLeagueFiltersPanel, {
      controls,
      leagues,
      seedLeagues: [],
      onChange: () => {},
      onApplied: () => {},
    });
    const panel = elements(tree).filter((el) => el.props.seat === "bay")[0];
    const extra = panel.props.extra as { options: { value: string }[] };
    assert.deepEqual(
      extra.options.map((o) => o.value),
      ["all", "full", "rookie"],
    );
    // The draft is seeded at mount, which is all a bay that unmounts on close
    // needs — there is no open state for the applied selection to drift under.
    assert.equal(panel.props.extraDraft, "rookie");
  });

  test("Apply commits once and shuts the bay; nothing else here writes", () => {
    const controls = defaultAdpControls("2026");
    const written: AdpControls[] = [];
    let applied = 0;
    const tree = treeOf(AdpLeagueFiltersPanel, {
      controls,
      leagues,
      seedLeagues: [],
      onChange: (value: AdpControls) => written.push(value),
      onApplied: () => {
        applied += 1;
      },
    });
    const panel = elements(tree).filter((el) => el.props.seat === "bay")[0];

    // Editing the draft reaches this host's own state and never the store: the
    // counts beside every option are unreadable if the population moves while
    // they are being read, and this board is a network read besides.
    press(panel, "onChange")({ ...controls.leagueRules, status: "pre_draft" });
    press(panel, "onExtraChange")("rookie");
    assert.deepEqual(written, []);
    assert.equal(applied, 0);

    // And Apply is **one** write carrying both halves — see `withLeagueFilters`,
    // which is where the argument for why it must be one lives.
    press(panel, "onApply")();
    assert.deepEqual(written, [
      withLeagueFilters(controls, controls.leagueRules, controls.rounds),
    ]);
    assert.equal(applied, 1);
  });

  test("Reset returns both halves to the board's defaults", () => {
    const tree = treeOf(AdpLeagueFiltersPanel, {
      controls: { ...defaultAdpControls("2026"), rounds: "rookie" as const },
      leagues,
      seedLeagues: [],
      onChange: () => {},
      onApplied: () => {},
    });
    const panel = elements(tree).filter((el) => el.props.seat === "bay")[0];
    // The row's own default rather than its first option — the board opens
    // narrowed to startups, which is the one filter here that does.
    assert.equal(
      (panel.props.extra as { defaultValue: string }).defaultValue,
      DEFAULT_ADP_ROUNDS,
    );
    // Reset edits the draft and commits nothing, exactly as the rows do.
    press(panel, "onReset")();
  });

  test("the board's head holds no keys of its own — every control in it sorts", () => {
    // The two market keys are gone: they offered to take away one of two
    // columns the board draws side by side anyway, and the draft counts they
    // carried are on the ADP headings' hover, against the column they describe.
    const tree = AdpBoardHeader({
      both: true,
      soleBoard: "redraft",
      soleDrafts: 900,
      redraftDrafts: 900,
      dynastyDrafts: 304,
      rules: DEFAULT_LEAGUE_FILTERS,
      sort: DEFAULT_ADP_SORT,
      onSort: () => {},
    });
    const pressable = elements(tree).filter(
      (el) => typeof el.props.onToggle === "function" || typeof el.props.onClick === "function",
    );
    assert.deepEqual(pressable, []);

    const html = drawer();
    assert.equal(/>Boards</.test(html), false);
    // The counts survive the keys, on the heading whose column they describe.
    assert.match(html, /title="[^"]*304 drafts in dynasty leagues"/);
    assert.match(html, /title="[^"]*900 drafts in redraft and keeper leagues"/);
  });

  test("a season key drops the window with the season", () => {
    let next: string | null = null;
    const tree = AdpDrawerHeader({
      seasons: ["2026", "2025", "all"],
      season: "2026",
      draftCount: 1204,
      onSeasonChange: (season) => {
        next = season;
      },
      onClose: () => {},
    });
    const keys = elements(tree).filter((el) => typeof el.props.on === "boolean");
    assert.equal(keys.length, 3);
    assert.deepEqual(keys.map((k) => k.props.on), [true, false, false]);
    press(keys[1], "onClick")();
    assert.equal(next, "2025");
  });

  test("the footer's Reset and Done reach the props they were given", () => {
    let reset = 0;
    let closed = 0;
    const tree = AdpDrawerFooter({
      rules: DEFAULT_LEAGUE_FILTERS,
      premiseId: "premise",
      onReset: () => {
        reset += 1;
      },
      onClose: () => {
        closed += 1;
      },
    });
    const buttons = elements(tree).filter((el) => el.type === "button");
    assert.equal(buttons.length, 2);
    press(buttons[0], "onClick")();
    press(buttons[1], "onClick")();
    assert.equal(reset, 1);
    assert.equal(closed, 1);
  });
});
