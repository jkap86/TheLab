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
  defaultAdpControls,
  seedFromLeague,
} from "../../adp-controls.ts";
import type { AdpState } from "../../use-adp.ts";
import { AdpBoardHeader } from "./adp-board-header.tsx";
import { AdpDrawer } from "./adp-drawer.tsx";
import { AdpDrawerFooter } from "./adp-drawer-footer.tsx";
import { AdpDrawerHeader } from "./adp-drawer-header.tsx";
import { AdpFilterBar } from "./adp-filter-bar.tsx";
import { AdpLeagueSeedControl } from "./adp-league-seed-control.tsx";
import {
  ADP_DRAWER_ENTER_MS,
  ADP_DRAWER_EXIT_MS,
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
  FIXED_FILTERS,
} from "./adp-drawer.constants.ts";
import { leagueSizeFilter } from "./adp-drawer.utils.ts";

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
  ...over,
});

const payload = (over: Partial<AdpPayload> = {}): AdpPayload => ({
  filters: {} as AdpPayload["filters"],
  draft_count: 1204,
  redraft_drafts: 900,
  dynasty_drafts: 304,
  player_count: 5000,
  players: [player("1"), player("2"), player("3")],
  ...over,
});

const loaded = (over: Partial<AdpPayload> = {}): AdpState => ({
  data: payload(over),
  error: null,
  loading: false,
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
const filterBarProps = {
  seedLeagues: [] as readonly ManagerLeague[],
  trayId: "tray",
  triggerRef: { current: null },
  onToggle: () => {},
  onChange: () => {},
};

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
    for (const tag of ["<button", "<select", "<input"]) {
      assert.ok(panel.includes(tag), `the dialog should render a ${tag} tab stop`);
    }
    // And the dialog itself is not one of them: `tabindex="-1"` is on the same
    // element as `role="dialog"`, so the focus move on open lands somewhere the
    // trap reads as "not on a stop" and the first Tab goes to the first control.
    const openingTag = panel.slice(0, panel.indexOf(">"));
    assert.match(openingTag, /tabindex="-1"/);
    assert.match(openingTag, /adp-drawer-panel/);
  });

  test("every control keeps an accessible name", () => {
    const html = drawer({ seedLeagues: leagues });
    for (const spec of [...FIXED_FILTERS, leagueSizeFilter(leagues)]) {
      // Only the narrowing filters are on screen at rest, so open the tray's
      // worth by narrowing each in turn.
      const controls = spec.set(defaultAdpControls("2026"), spec.options[1].value);
      assert.match(drawer({ controls }), new RegExp(`aria-label="${spec.ariaLabel}"`));
    }
    assert.match(html, /aria-label="Value curve steepness"/);
    // The apostrophe arrives HTML-escaped, which is the markup being right.
    assert.match(html, /aria-label="Match one of this manager(&#x27;|')s leagues"/);
  });
});

describe("the board's states", () => {
  test("a failed read says so and draws no list", () => {
    const html = drawer({ board: { data: null, error: "boom", loading: false } });
    assert.match(html, /ADP unavailable — boom/);
    assert.doesNotMatch(html, /<ul>/);
  });

  test("a first load says it is loading", () => {
    const html = drawer({ board: { data: null, error: null, loading: true } });
    assert.match(html, /Loading the board…/);
  });

  test("an empty board says the filters matched nothing", () => {
    const html = drawer({ board: { data: null, error: null, loading: false } });
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

  test("the value columns are seated behind the panel's own container query", () => {
    // `@md`, which measures the drawer rather than the viewport.
    assert.match(drawer(), /hidden text-right @md:block/);
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
    const html = drawer({ seedLeagues: leagues });
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
  test("a filter chip hands back the controls with that one field written", () => {
    const controls: AdpControls = { ...defaultAdpControls("2026"), scoring: "ppr" };
    let next: AdpControls | null = null;
    const tree = AdpFilterBar({
      controls,
      filters: [...FIXED_FILTERS, leagueSizeFilter(leagues)],
      seedLeagues: [],
      open: false,
      trayId: "tray",
      triggerRef: { current: null },
      onToggle: () => {},
      onChange: (value) => {
        next = value;
      },
    });
    press(only(tree, "ariaLabel", "Scoring"), "onChange")("half_ppr");
    assert.deepEqual(next, { ...controls, scoring: "half_ppr" });
  });

  test("only the narrowing filters are on the closed row, and the tray holds all", () => {
    const filters = [...FIXED_FILTERS, leagueSizeFilter(leagues)];
    const controls: AdpControls = { ...defaultAdpControls("2026"), scoring: "ppr" };
    const closed = elements(
      AdpFilterBar({ ...filterBarProps, controls, filters, open: false }),
    ).filter((el) => typeof el.props.ariaLabel === "string");
    // The kind-of-draft chip is on the closed row untouched, because the board
    // opens on startups: this row says what the population in front of the
    // reader is cut by, and a startup-only board saying nothing would leave its
    // largest fact about itself unsaid. It is also the way back to every draft.
    assert.deepEqual(closed.map((el) => el.props.ariaLabel), ["Kind of draft", "Scoring"]);

    const open = elements(
      AdpFilterBar({ ...filterBarProps, controls, filters, open: true }),
    ).filter((el) => typeof el.props.ariaLabel === "string");
    assert.deepEqual(open.map((el) => el.props.ariaLabel), filters.map((f) => f.ariaLabel));
  });

  test("a board key toggles that market, and the last one lit stays lit", () => {
    const toggles: string[] = [];
    const tree = AdpBoardHeader({
      both: false,
      shown: { redraft: true, dynasty: false },
      soleBoard: "redraft",
      soleDrafts: 900,
      redraftDrafts: 900,
      dynastyDrafts: 304,
      teams: "all",
      onToggleBoard: (board) => toggles.push(board),
    });
    const keys = elements(tree).filter((el) => typeof el.props.onToggle === "function");
    assert.equal(keys.length, 2);
    for (const key of keys) press(key, "onToggle")(key.props.board);
    assert.deepEqual(toggles, ["redraft", "dynasty"]);
    // Which of those presses changes anything is `toggleAdpBoard`'s rule, and
    // `withBoardToggle`'s test above is where it is checked.
    assert.deepEqual(keys.map((k) => k.props.on), [true, false]);
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
      teams: "all",
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
