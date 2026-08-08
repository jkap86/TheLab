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

import {
  DEFAULT_LEAGUE_FILTERS,
  type FilterRule,
  type LeagueFilters,
  NO_TRADE_DEADLINE,
  SLOT_GROUPS,
  STATUS_OPTIONS,
  activeFilterCount,
  matchesFilters,
  matchesSlotRule,
} from "../../league-filters/index.ts";
import type { ManagerLeague } from "@/shared/manager";

import { FilterRail } from "./filter-rail.tsx";
import { FiltersDialogHeader } from "./filters-dialog-header.tsx";
import { FiltersTrigger } from "./filters-trigger.tsx";
import { LeagueFiltersFooter } from "./league-filters-footer.tsx";
import { LeagueFiltersModal } from "./league-filters-modal.tsx";
import { SLOT_PRESETS } from "./league-filters-modal.constants.ts";
import { RuleBay } from "./rule-bay.tsx";
import { RuleRow } from "./rule-row.tsx";
import { SeasonBand } from "./season-band.tsx";
import { SegmentTrough } from "./segment-trough.tsx";
import { useLeagueFiltersModal } from "./use-league-filters-modal.ts";

/**
 * The dialog without a DOM.
 *
 * The same two techniques as `adp-drawer.render.test`, and the same honest
 * limit: `renderToStaticMarkup` answers what a reader *sees* (React runs on the
 * server, so this needs no browser and no dependency), and calling the hook-free
 * sections as plain functions answers what their controls *do*, since a React
 * element carries its handlers as props. What neither reaches is anything an
 * effect owns — `showModal`, the focus move onto the panel, the outside-press
 * dismissal and Escape's innermost-first rule all need a real dialog element.
 * Those live in `use-league-filters-modal` and are documented there.
 *
 * **There is no longer a state that the modal cannot reach.** While the fixed
 * filters were collapsed rows, the open popover had to be rendered on its own —
 * nothing can press a row without a document — so the branch carrying its
 * option keys and their counts was reached through `SegmentRow` directly. Drawn
 * as rails, every option and every count is in the modal's own markup, which is
 * why the cases below read it there.
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

/**
 * A handler off an element's props. The runtime check is what makes the cast
 * safe — element props are `unknown` and there is no narrower type available.
 */
function press(el: ReactElement<Props>, name: string): (...args: unknown[]) => void {
  const handler = el.props[name];
  assert.equal(typeof handler, "function", `expected ${name} to be a handler`);
  return handler as (...args: unknown[]) => void;
}

const league = (id: string, over: Partial<ManagerLeague> = {}): ManagerLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2026",
  status: "in_season",
  total_rosters: 12,
  avatar: null,
  record: null,
  settings: { type: 2, best_ball: 0 },
  roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "TE", "FLEX", "BN"],
  scoring_settings: { rec: 0.5, bonus_rec_te: 0.5 },
  ...over,
});

const leagues: ManagerLeague[] = [
  league("a"),
  league("b", { status: "pre_draft", settings: { type: 0, best_ball: 1 } }),
  league("c", {
    settings: { type: 1 },
    roster_positions: ["QB", "RB", "WR", "K", "DEF", "BN"],
    scoring_settings: { rec: 1 },
  }),
];

const superflex: FilterRule = { key: "QB+SF", op: "gte", value: 2 };

/** The status rail on its own, for the cases about one row's own markup. */
function statusRail(value: LeagueFilters["status"] = "all"): string {
  return renderToStaticMarkup(
    createElement(FilterRail, {
      label: "Status",
      options: STATUS_OPTIONS,
      value: value as string,
      leagues,
      probe: (next: string) => ({
        ...DEFAULT_LEAGUE_FILTERS,
        status: next as LeagueFilters["status"],
      }),
      onPick: () => {},
    }),
  );
}

/**
 * Leagues spanning two seasons — the one population the season band draws for,
 * and the ADP board's widest setting is the only caller that produces it.
 */
const twoSeasons: ManagerLeague[] = [
  ...leagues,
  league("d", { season: "2025" }),
];

/**
 * A section that uses hooks, run for its returned tree rather than its markup.
 *
 * Calling it inside a probe's body is the same technique `mountHook` uses on
 * `useLeagueFiltersModal`: React's dispatcher is live during
 * `renderToStaticMarkup`, so the section's own `useState` binds to the probe's
 * hook slot. That is what lets a row's handlers be pressed — markup carries the
 * options and the pressed states, but not the callbacks.
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

function modal(over: Partial<Parameters<typeof LeagueFiltersModal>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(LeagueFiltersModal, {
      filters: DEFAULT_LEAGUE_FILTERS,
      onChange: () => {},
      leagues,
      ...over,
    }),
  );
}

describe("what is on screen", () => {
  test("the dialog is labelled by its own title, and the panel takes the focus", () => {
    const html = modal();
    // The id is generated rather than literal, because **two of these dialogs
    // are on the page at once** — the manager Leagues tab renders one in the
    // header plate's corner and the shares sheet opened from its rail renders a
    // second. So what is asserted is the *relationship* rather than a string:
    // the label points at a heading that is actually in this markup.
    const titleId = html.match(/aria-labelledby="([^"]*)"/)?.[1];
    assert.ok(titleId, "expected the dialog to be labelled");
    assert.match(html, new RegExp(`<h2 id="${titleId}"`));
    // Focusable as the target for the focus move on open, but out of the tab
    // order — `showModal` would otherwise land the ring on the close button.
    assert.match(html, /tabindex="-1"/);
    assert.match(html, /aria-label="Close"/);
  });

  test("every id is unique and every reference to one resolves", () => {
    // The property a literal id breaks the moment a second dialog mounts, which
    // is a real state on the Leagues tab — and the one a string assertion above
    // would happily pass while both dialogs pointed at the same heading.
    const html = modal();
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

  test("the trigger says it opens a dialog", () => {
    assert.match(modal(), /aria-haspopup="dialog"/);
  });

  test("the panel plays its entrance, and nothing else animates", () => {
    assert.match(modal(), /animation:dialog-rise 0\.18s cubic-bezier\(0\.2,0\.9,0\.3,1\)/);
    assert.match(modal(), /filters-dialog-panel/);
    // The class is named in the reduced-motion block in `globals.css`, which is
    // what freezes it — so the name is the contract, not decoration.
    //
    // `filters-segment-pop` went with the popovers. A rail has nothing that
    // arrives, so there is no second entrance to freeze.
    assert.doesNotMatch(modal(), /filters-segment-pop/);
  });

  test("every fixed filter is a labelled rail, with every option on it", () => {
    const html = modal();
    for (const label of ["Status", "Type", "Format"]) {
      assert.match(
        html,
        new RegExp(`role="group" aria-label="${label}"`),
        `expected a ${label} rail`,
      );
    }
    // The whole of what the collapse cost: every option on screen at rest,
    // rather than the three that happened to be selected.
    for (const word of [
      "Any status", "Pre-draft", "Drafting", "In season", "Complete",
      "All types", "Redraft", "Keeper", "Dynasty", "Chopped",
      "All formats", "Best ball", "Lineup",
    ]) {
      assert.ok(html.includes(word), `expected ${word} on the panel`);
    }
    // Nothing discloses any more, so nothing claims to.
    assert.doesNotMatch(html, /aria-expanded/);
    assert.doesNotMatch(html, /aria-haspopup="true"/);
  });

  test("a rail marks exactly one option and counts every one of them", () => {
    const html = statusRail("in_season");
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal(
      (html.match(/aria-pressed="false"/g) ?? []).length,
      STATUS_OPTIONS.length - 1,
    );
    // The counts are the dialog's whole argument over the bar it replaced, and
    // behind a press they were three of thirteen. Every option carries one:
    // two of these leagues are in season, one is pre-draft, none are complete.
    for (const count of [">3<", ">2<", ">1<", ">0<"]) {
      assert.ok(html.includes(count), `expected a ${count} count on the rail`);
    }
  });

  test("the rails are a cross-tab: one row's pick moves the next row's counts", () => {
    // Every probe closes over the draft, so lighting Dynasty rewrites the Format
    // row's numbers underneath it. That is the thing two popovers could not show
    // at once, and it is why they are rails.
    const wide = modal();
    const narrowed = modal({
      filters: { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
    });
    const formatCounts = (html: string) =>
      html.slice(html.indexOf('aria-label="Format"')).match(/tabular-nums[^>]*>(\d+)</g);
    assert.notDeepEqual(formatCounts(wide), formatCounts(narrowed));
  });

  test("omitting the type row drops it and leaves the others where they were", () => {
    // The ADP board's call. The type is a *display* question there — every fetch
    // answers both markets and the board keys choose — so a row narrowing the
    // population on the same axis is a second answer to one question.
    const html = modal({ omit: ["type"] });
    for (const label of ["Status", "Format"]) {
      assert.match(html, new RegExp(`aria-label="${label}"`), `expected a ${label} rail`);
    }
    assert.doesNotMatch(html, /aria-label="Type"/);
    // Its selection goes with it — the caption check alone would pass on a row
    // that had merely lost its label. Not `Dynasty`, which the breakdown below
    // still counts: that describes the survivors rather than narrowing them.
    for (const word of ["All types", "Redraft", "Keeper", "Chopped"]) {
      assert.ok(!html.includes(word), `expected ${word} to be off the panel`);
    }
    // The row's absence is the only thing that changed.
    assert.match(html, /Any status/);
    assert.match(html, /All formats/);
  });

  test("a type the omitted row can't reach is still named and clearable", () => {
    // What keeps the omission from being a filter a reader can neither see nor
    // undo: the rail walks `activeFilters`, which is a fact about the selection
    // rather than about which controls happen to be drawn.
    const html = modal({
      omit: ["type"],
      filters: { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
    });
    assert.match(html, /aria-label="Stop filtering by dynasty"/);
  });

  test("every rule control keeps an accessible name", () => {
    const html = modal({ filters: { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex] } });
    for (const name of ["Filter on", "Comparison", "Value"]) {
      assert.match(html, new RegExp(`aria-label="${name}"`));
    }
    // The remove key names *its own rule* rather than saying "Remove rule": a
    // bay holds half a dozen of these, and a screen reader listing six
    // identically named buttons gives a reader nothing to choose between.
    // A literal `includes` rather than a regex: the slot group is `QB+SF`, and
    // the `+` in a pattern is a quantifier.
    assert.ok(
      html.includes(
        `aria-label="Remove rule ${superflex.key} ${superflex.op} ${superflex.value}"`,
      ),
      "expected the remove key to name its own rule",
    );
  });

  test("a rule on a key the menu doesn't offer still shows its own key", () => {
    // The silent failure this prevents: a `<select>` whose value is absent from
    // its options renders the first one instead.
    const html = modal({
      filters: {
        ...DEFAULT_LEAGUE_FILTERS,
        scoring: [{ key: "bonus_rec_wr", op: "gt", value: 0 }],
      },
    });
    // Present *and* the selected one — which is the whole point, since a select
    // falling back to `rec` would read as filtering on something it isn't.
    assert.match(html, /<option value="bonus_rec_wr" selected="">bonus rec wr<\/option>/);
    assert.equal((html.match(/<option[^>]*selected=""/g) ?? []).length, 2, "the key and its comparison");
  });

  test("the rail names the narrowing filters, each with a way to drop it", () => {
    const html = modal({ filters: { ...DEFAULT_LEAGUE_FILTERS, type: "2", slots: [superflex] } });
    assert.match(html, /aria-label="Matching leagues"/);
    assert.match(html, /aria-label="Stop filtering by dynasty"/);
    assert.match(html, /aria-label="Stop filtering by qb\+sf ≥ 2"/);
  });

  test("with nothing selected the rail says so rather than showing an empty row", () => {
    assert.match(modal(), /Nothing yet — every league is in\./);
  });

  test("the meter and the percentage sit out a cold load, where 0 of 0 is not 0%", () => {
    const cold = modal({ leagues: [] });
    assert.match(cold, /of 0/);
    assert.doesNotMatch(cold, /· \d+%/);
    assert.match(cold, /width:0%/);
    // And a loaded board states both.
    assert.match(modal(), /· 100%/);
    assert.match(modal(), /width:100%/);
  });

  test("all three empty bays say what a rule there would do", () => {
    const html = modal();
    assert.match(html, /Any settings\. Add a rule to narrow by how a league is set up\./);
    assert.match(html, /Any lineup\. Add a rule to narrow by what a league starts\./);
    assert.match(html, /Any scoring\. Add a rule to narrow by what a league pays\./);
  });

  test("the footer states the count for the width the rail is stacked at", () => {
    const html = modal();
    // `@4xl`, which measures the panel rather than the viewport — the same
    // container the grid splits on, so the width at which the rail steps beside
    // the controls is the width at which this stops restating its count.
    assert.match(html, /@4xl:hidden/);
    assert.match(html, /Every filter narrows — a league has to pass all of them\./);
  });

  test("every layout threshold in the panel measures a container, not the screen", () => {
    // The panel is drawn at ~450px inside the ADP drawer's Leagues bay on a
    // laptop, so a viewport breakpoint here is a two-column grid in a box less
    // than half the width it was written for. What is asserted is the absence:
    // one `lg:` or `md:` survivor is a layout that silently breaks in one host.
    assert.doesNotMatch(modal(), /(?:^|["\s])(?:sm|md|lg|xl|2xl):/);
  });

  test("rows and options have unique keys — React would warn otherwise", () => {
    const warnings: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => warnings.push(args);
    try {
      // Two identical rules is the case keys by position exist for.
      modal({ filters: { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex, superflex] } });
    } finally {
      console.error = original;
    }
    assert.deepEqual(warnings, []);
  });
});

/**
 * The season band, which is drawn only where there is a season to choose — every
 * caller but the ADP board's widest setting resolves one server-side.
 */
describe("the season band", () => {
  test("one season is no choice, so nothing is drawn", () => {
    // The ordinary case. A control with one option, permanently lit, reports a
    // fact rather than offering a choice — which is the thing every other row in
    // this panel was shortened to stop doing.
    assert.doesNotMatch(modal(), /aria-label="Season"/);
    assert.doesNotMatch(modal({ leagues: [] }), /aria-label="Season"/);
  });

  test("two seasons turn it on by themselves, with every season counted", () => {
    const html = modal({ leagues: twoSeasons });
    assert.match(html, /role="group" aria-label="Season"/);
    for (const word of ["All seasons", "2026", "2025"]) {
      assert.ok(html.includes(word), `expected ${word} on the band`);
    }
    // And it says which way the arrow points between it and the counts below.
    assert.match(html, /Everything below narrows across all of them\./);
  });

  test("a chosen season names itself in the sentence under the keys", () => {
    const html = modal({
      leagues: twoSeasons,
      filters: { ...DEFAULT_LEAGUE_FILTERS, season: "2025" },
    });
    assert.match(html, /Everything below narrows within 2025\./);
  });

  test("omitting it drops the band even where there are seasons to pick", () => {
    // The ADP board's call: its pinned block leads with its own season row, and
    // a second one inside the dialog is a finer cut on an axis already answered.
    const html = modal({ leagues: twoSeasons, omit: ["season"] });
    assert.doesNotMatch(html, /aria-label="Season"/);
    assert.ok(!html.includes("All seasons"), "its keys go with it");
  });

  test("a season the omitted band can't reach is still named and clearable", () => {
    const html = modal({
      leagues: twoSeasons,
      omit: ["season"],
      filters: { ...DEFAULT_LEAGUE_FILTERS, season: "2025" },
    });
    assert.match(html, /aria-label="Stop filtering by 2025"/);
  });

  test("picking a season writes that field and nothing else", () => {
    let next: LeagueFilters | null = null;
    const draft: LeagueFilters = { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex] };
    const tree = SeasonBand({
      draft,
      onChange: (value) => {
        next = value;
      },
      leagues: twoSeasons,
      seasons: ["2026", "2025"],
    });
    const [rail] = elements(tree).filter((el) => typeof el.props.probe === "function");
    press(rail, "onPick")("2025");
    assert.deepEqual(next, { ...draft, season: "2025" });
  });
});

/**
 * The settings bay, which was `League size` holding one key. What is new is the
 * vocabulary and the two things a bare number field cannot say.
 */
describe("the settings bay", () => {
  /** A league carrying the settings the bay is about. */
  const configured = league("cfg", {
    settings: { type: 2, best_ball: 0, disable_trades: 0, trade_deadline: 12, taxi_slots: 3 },
  });

  const withSettings = (rules: FilterRule[], over: Partial<ManagerLeague>[] = []) =>
    modal({
      leagues: [configured, ...over.map((o, i) => league(`x${i}`, o))],
      filters: { ...DEFAULT_LEAGUE_FILTERS, settings: rules },
    });

  test("it leads the panel under its own name, with the pair below it", () => {
    const html = modal();
    for (const label of ["Settings", "Roster slots", "Scoring"]) {
      assert.ok(html.includes(`>${label}</span>`), `expected a ${label} bay`);
    }
    // `Scoring` rather than `Scoring settings`, which would be one word doing
    // two jobs beside a bay now called Settings.
    assert.ok(!html.includes("Scoring settings"), "the scoring bay dropped its second word");
  });

  test("the key menu offers teams plus what the leagues in hand carry", () => {
    const html = withSettings([{ key: "teams", op: "eq", value: 12 }]);
    for (const key of ["teams", "disable_trades", "trade_deadline", "taxi_slots"]) {
      assert.match(html, new RegExp(`<option value="${key}"`), `expected ${key} on the menu`);
    }
    // Not the two the rails four inches above already ask about.
    assert.doesNotMatch(html, /<option value="type"/);
    assert.doesNotMatch(html, /<option value="best_ball"/);
  });

  test("a key whose numbers are names gets a menu, and only = and ≠", () => {
    const html = withSettings([{ key: "disable_trades", op: "eq", value: 1 }]);
    // The value is the name, selected — not a `1` a reader has to decode.
    assert.match(html, /<option value="1" selected="">Disabled<\/option>/);
    assert.match(html, /<option value="0">Enabled<\/option>/);
    // And the comparison narrows to the two that have a reading. An ordering on
    // an enum is a rule that reads as a sentence and narrows by an accident of
    // the coding.
    assert.match(html, /<option value="eq"/);
    assert.match(html, /<option value="ne"/);
    for (const op of ["gt", "lt", "gte", "lte"]) {
      assert.doesNotMatch(html, new RegExp(`<option value="${op}"`));
    }
  });

  test("a value the names don't cover is still shown rather than silently swapped", () => {
    // The `unlistedKey` failure one field over: a `<select>` whose value is
    // absent from its options renders the first one instead, so the row would
    // read as `Enabled` while the rule says 7.
    const html = withSettings([{ key: "disable_trades", op: "eq", value: 7 }]);
    assert.match(html, /<option value="7" selected="">7<\/option>/);
  });

  test("a quantity keeps its number field and every comparison", () => {
    const html = withSettings([{ key: "taxi_slots", op: "gt", value: 0 }]);
    assert.match(html, /aria-label="Value"[^>]*type="number"/);
    // The symbol form, and every comparison on the menu — the text is `>`, so
    // the option's own value is what identifies it.
    assert.match(html, /<option value="gt"/);
    assert.match(html, /<option value="lt"/);
  });

  test("switching to a named key lands on a rule that means something", () => {
    // A key with names has no reading for the number the old key was comparing
    // against, and none for `>` either.
    let next: FilterRule | null = null;
    const tree = treeOf(RuleRow, {
      rule: { key: "taxi_slots", op: "gt", value: 3 } as FilterRule,
      keyOptions: [
        { value: "taxi_slots", label: "Taxi slots" },
        { value: "disable_trades", label: "Trades" },
      ],
      extraKey: null,
      step: 1,
      fallback: 12,
      count: 0,
      onChange: (rule) => {
        next = rule;
      },
      onRemove: () => {},
    });
    const [keyMenu] = elements(tree).filter((el) => el.props["aria-label"] === "Filter on");
    press(keyMenu, "onChange")({ target: { value: "disable_trades" } });
    assert.deepEqual(next, { key: "disable_trades", op: "eq", value: 0 });
  });
});

/**
 * The sentinel row. `trade_deadline: 99` is Sleeper's "no deadline", so the row
 * needs both controls at once: a number field for the weeks, and a way to reach
 * the one value that is not a week.
 */
describe("the trade-deadline row", () => {
  const row = (rule: FilterRule, onChange: (next: FilterRule) => void = () => {}) =>
    treeOf(RuleRow, {
      rule,
      keyOptions: [{ value: "trade_deadline", label: "Trade deadline" }],
      extraKey: null,
      step: 1,
      fallback: 12,
      count: 0,
      onChange,
      onRemove: () => {},
    });

  const html = (rule: FilterRule) => renderToStaticMarkup(row(rule));


  test("a week rule keeps the number field, with the sentinel beside it unlit", () => {
    const markup = html({ key: "trade_deadline", op: "lte", value: 12 });
    assert.match(markup, /aria-label="Value"[^>]*type="number"/);
    assert.match(markup, /aria-pressed="false"[^>]*>No deadline</);
  });

  test("on the sentinel, the field stands down and the key is lit", () => {
    // Lit, the sentinel *is* the value — a number field showing 99 beside it
    // would be the one place a reader meets the bare digits.
    const markup = html({ key: "trade_deadline", op: "eq", value: NO_TRADE_DEADLINE });
    assert.doesNotMatch(markup, /aria-label="Value"/);
    assert.match(markup, /aria-pressed="true"[^>]*>No deadline</);
    // And the comparison narrows with it: `≥ 99` is a comparison nothing reads.
    assert.doesNotMatch(markup, /<option value="gt"/);
  });

  test("pressing it writes the sentinel rule; pressing it lit returns to the scale", () => {
    let next: FilterRule | null = null;
    const into = elements(row({ key: "trade_deadline", op: "lte", value: 12 }, (rule) => {
      next = rule;
    })).find((el) => el.props["aria-pressed"] !== undefined);
    assert.ok(into, "expected the sentinel key");
    press(into, "onClick")();
    assert.deepEqual(next, { key: "trade_deadline", op: "eq", value: NO_TRADE_DEADLINE });

    const back = elements(row({ key: "trade_deadline", op: "eq", value: NO_TRADE_DEADLINE }, (rule) => {
      next = rule;
    })).find((el) => el.props["aria-pressed"] !== undefined);
    assert.ok(back, "expected the sentinel key");
    press(back, "onClick")();
    // Back at the bay's own starting number, never at 99 — which on this scale
    // does not mean a week.
    assert.deepEqual(next, { key: "trade_deadline", op: "eq", value: 12 });
  });

  test("a key with no sentinel draws no such control", () => {
    const markup = renderToStaticMarkup(
      treeOf(RuleRow, {
        rule: { key: "taxi_slots", op: "gt", value: 0 } as FilterRule,
        keyOptions: [{ value: "taxi_slots", label: "Taxi slots" }],
        extraKey: null,
        step: 1,
        fallback: 12,
        count: 0,
        onChange: () => {},
        onRemove: () => {},
      }),
    );
    assert.doesNotMatch(markup, /aria-pressed/);
  });
});

describe("the trigger", () => {
  test("it is unlit and unbadged with nothing selected", () => {
    const html = renderToStaticMarkup(
      createElement(FiltersTrigger, { label: "Filters", seat: "free" as const, active: 0, onOpen: () => {} }),
    );
    assert.match(html, /lab-chip text-foreground\/85/);
    assert.doesNotMatch(html, /lab-chip-on/);
    assert.match(html, /stroke-foreground\/55/);
  });

  test("it lights and wears the count once something narrows", () => {
    const html = renderToStaticMarkup(
      createElement(FiltersTrigger, { label: "Leagues", seat: "free" as const, active: 3, onOpen: () => {} }),
    );
    assert.match(html, /lab-chip-on/);
    assert.match(html, />3</);
    assert.match(html, /Leagues/);
  });

  test("each seat draws the same part at its own metrics", () => {
    for (const seat of ["free", "bar", "rail"] as const) {
      const html = renderToStaticMarkup(
        createElement(FiltersTrigger, { label: "Filters", seat, active: 1, onOpen: () => {} }),
      );
      assert.match(html, /lab-chip-on/, `${seat} keeps the lit material`);
      assert.match(html, />1</, `${seat} keeps the badge`);
    }
    // `rail` is the one seated among two other keys, so it is the one that
    // reaches past shape — it takes their thinner wall as well as their metrics,
    // since a key standing a pixel prouder than its neighbours reads as a state.
    const rail = renderToStaticMarkup(
      createElement(FiltersTrigger, { label: "Filters", seat: "rail" as const, active: 1, onOpen: () => {} }),
    );
    assert.match(rail, /lab-chip-sm/);
  });

  test("the label defaults to Filters, which is the placeholder's word too", () => {
    assert.match(modal(), /Filters/);
    assert.match(modal({ label: "Leagues" }), /Leagues/);
  });
});

describe("what the controls do", () => {
  test("picking a rail option writes that one field and no other", () => {
    let next: LeagueFilters | null = null;
    const tree = SegmentTrough({
      draft: { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
      onChange: (value) => {
        next = value;
      },
      leagues,
    });
    const rails = elements(tree).filter((el) => typeof el.props.probe === "function");
    assert.equal(rails.length, 3);
    press(rails[0], "onPick")("pre_draft");
    // The rest of the draft survives — a rail edits its own field and no other.
    assert.deepEqual(next, { ...DEFAULT_LEAGUE_FILTERS, type: "2", status: "pre_draft" });
  });

  test("omitting the type rail renumbers nothing — Format still edits Format", () => {
    const edits: LeagueFilters[] = [];
    const tree = SegmentTrough({
      draft: DEFAULT_LEAGUE_FILTERS,
      onChange: (next) => edits.push(next),
      leagues,
      omit: ["type"],
    });
    const rails = elements(tree).filter((el) => typeof el.props.probe === "function");
    assert.deepEqual(rails.map((rail) => rail.props.label), ["Status", "Format"]);
    press(rails[1], "onPick")("yes");
    assert.deepEqual(edits, [{ ...DEFAULT_LEAGUE_FILTERS, bestBall: "yes" }]);
  });

  test("a row's probe describes the whole draft with one field changed", () => {
    const draft: LeagueFilters = { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex] };
    const tree = SegmentTrough({ draft, onChange: () => {}, leagues });
    const [status] = elements(tree).filter((el) => typeof el.props.probe === "function");
    const probe = status.props.probe as (value: string) => LeagueFilters;
    // The counts are the answer to "what would this leave", not "what does this
    // filter match on its own" — so the rules stay on the probed selection.
    assert.deepEqual(probe("done"), { ...draft, status: "done" });
  });

  test("adding a rule appends the bay's own starting rule", () => {
    let next: FilterRule[] | null = null;
    const tree = RuleBay({
      label: "Roster slots",
      empty: "…",
      rules: [],
      onChange: (rules) => {
        next = rules;
      },
      keyOptions: SLOT_GROUPS.map((g) => ({ value: g.key, label: g.label, hint: g.hint })),
      newRule: superflex,
      presets: SLOT_PRESETS,
      step: 1,
      leagues,
      match: matchesSlotRule,
    });
    const add = elements(tree).find(
      (el) => el.type === "button" && el.props.disabled === undefined,
    );
    assert.ok(add, "expected the add button");
    press(add, "onClick")();
    assert.deepEqual(next, [superflex]);
  });

  test("a quick-add writes its rule, and dims once it is on the list", () => {
    const bay = (rules: FilterRule[], onChange: (r: FilterRule[]) => void = () => {}) =>
      RuleBay({
        label: "Roster slots",
        empty: "…",
        rules,
        onChange,
        keyOptions: [],
        newRule: superflex,
        presets: SLOT_PRESETS,
        step: 1,
        leagues,
        match: matchesSlotRule,
      });

    // **The dimmed state is `aria-disabled`, not `disabled`** — a preset that is
    // already on the list is not an unavailable control, it is one carrying a
    // fact worth reaching and hearing, and `disabled` took it out of the tab
    // order and the explanation with it. So the press has to be a no-op rather
    // than merely unreachable, which is the half a `disabled` attribute gave for
    // free and this has to assert.
    const presetKeys = (tree: ReturnType<typeof bay>) =>
      elements(tree).filter(
        (el) => el.type === "button" && typeof el.props.onClick === "function",
      );

    let next: FilterRule[] | null = null;
    const live = presetKeys(bay([], (r) => {
      next = r;
    })).filter((el) => el.props["aria-disabled"] === undefined);
    // The bay's own "+ Rule" button is a press too, so the presets are what is
    // left once it is discounted.
    assert.equal(
      live.length,
      SLOT_PRESETS.length + 1,
      "every preset is live on an empty list, beside the add button",
    );
    press(live[1], "onClick")();
    assert.deepEqual(next, [SLOT_PRESETS[0].rule]);

    // Superflex now on the list: its own key dims, the other four stay live.
    const withSuperflex = presetKeys(bay([SLOT_PRESETS[0].rule]));
    const dimmed = withSuperflex.filter((el) => el.props["aria-disabled"] === true);
    assert.equal(dimmed.length, 1);
    assert.equal(
      withSuperflex.filter((el) => el.props["aria-disabled"] === undefined).length,
      SLOT_PRESETS.length,
    );

    // Still reachable, and still a no-op: pressing it must not add the rule a
    // second time.
    let after: FilterRule[] | null = null;
    press(
      presetKeys(bay([SLOT_PRESETS[0].rule], (r) => {
        after = r;
      })).filter((el) => el.props["aria-disabled"] === true)[0],
      "onClick",
    )();
    assert.equal(after, null, "a dimmed preset writes nothing");
  });

  test("a rule row edits and removes by position, with a twin beside it", () => {
    let next: FilterRule[] | null = null;
    const rules: FilterRule[] = [superflex, superflex];
    const tree = RuleBay({
      label: "Roster slots",
      empty: "…",
      rules,
      onChange: (r) => {
        next = r;
      },
      keyOptions: [],
      newRule: superflex,
      presets: [],
      step: 1,
      leagues,
      match: matchesSlotRule,
    });
    const rows = elements(tree).filter((el) => typeof el.props.rule === "object");
    assert.equal(rows.length, 2);

    press(rows[1], "onChange")({ ...superflex, value: 3 });
    assert.deepEqual(next, [superflex, { ...superflex, value: 3 }]);

    press(rows[0], "onRemove")();
    assert.deepEqual(next, [superflex]);
  });

  test("a rule row counts what that rule alone leaves, not what the draft leaves", () => {
    const tree = RuleBay({
      label: "Roster slots",
      empty: "…",
      rules: [superflex],
      onChange: () => {},
      keyOptions: [],
      newRule: superflex,
      presets: [],
      step: 1,
      leagues,
      match: matchesSlotRule,
    });
    const [row] = elements(tree).filter((el) => typeof el.props.rule === "object");
    // Two of the three fixtures start a second QB-eligible slot.
    assert.equal(row.props.count, 2);
  });

  test("the header's close, the footer's Reset and Apply reach the props they were given", () => {
    let closed = 0;
    press(elements(FiltersDialogHeader({ titleId: "t", onClose: () => (closed += 1) }))
      .filter((el) => el.type === "button")[0], "onClick")();
    assert.equal(closed, 1);

    let reset = 0;
    let applied = 0;
    const footer = elements(
      LeagueFiltersFooter({
        matched: 3,
        total: 12,
        hintId: "hint",
        onReset: () => (reset += 1),
        onApply: () => (applied += 1),
      }),
    ).filter((el) => el.type === "button");
    assert.equal(footer.length, 2);
    press(footer[0], "onClick")();
    press(footer[1], "onClick")();
    assert.equal(reset, 1);
    assert.equal(applied, 1);
  });

  test("the trigger's press is the caller's open", () => {
    let opened = 0;
    const tree = FiltersTrigger({
      label: "Filters",
      seat: "free",
      active: 0,
      onOpen: () => (opened += 1),
    });
    press(elements(tree).filter((el) => el.type === "button")[0], "onClick")();
    assert.equal(opened, 1);
  });
});

/**
 * The hook's own state, reached the one way it can be without a document.
 *
 * `renderToStaticMarkup` runs React's hook dispatcher — `useState`, `useRef`,
 * `useCallback` and `useId` all resolve — so a probe component can hand back
 * what `useLeagueFiltersModal` returned. Effects never run, and no setter is
 * called here (a state update outside a render has nothing to re-render on the
 * server), so what this reaches is exactly the seeding and the callbacks that
 * read the draft as it stands.
 */
function mountHook(
  filters: LeagueFilters,
  onChange: (next: LeagueFilters) => void = () => {},
) {
  const captured: ReturnType<typeof useLeagueFiltersModal>[] = [];
  function Probe() {
    captured.push(useLeagueFiltersModal(filters, onChange));
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  assert.equal(captured.length, 1, "expected the probe to have run the hook once");
  return captured[0];
}

describe("the draft the dialog edits", () => {
  test("it is seeded from the applied filters", () => {
    // Seeded on mount and re-seeded on open, rather than synced by an effect:
    // the page behind is inert while the dialog is up, so the only moment the
    // two can disagree is the moment it opens.
    const applied: LeagueFilters = {
      ...DEFAULT_LEAGUE_FILTERS,
      type: "2",
      slots: [superflex],
    };
    assert.deepEqual(mountHook(applied).draft, applied);
  });

  test("Apply emits the draft as it stands, and nothing else does", () => {
    const applied: LeagueFilters = { ...DEFAULT_LEAGUE_FILTERS, status: "in_season" };
    const emitted: LeagueFilters[] = [];
    const hook = mountHook(applied, (next) => emitted.push(next));

    // Closing and resetting are the two paths that must *not* reach the page:
    // the draft is discarded on close precisely because it is reseeded on open.
    hook.close();
    hook.reset();
    assert.deepEqual(emitted, [], "only Apply commits");

    hook.apply();
    assert.deepEqual(emitted, [applied]);
  });

  test("Reset's target is the selection the trigger reads as unnarrowed", () => {
    // What "reset" means is `DEFAULT_LEAGUE_FILTERS`, and the claim worth
    // pinning is that those defaults narrow nothing — a default that filtered
    // would leave the trigger badged with a count nobody chose.
    assert.equal(activeFilterCount(DEFAULT_LEAGUE_FILTERS), 0);
    assert.equal(leagues.filter((l) => matchesFilters(l, DEFAULT_LEAGUE_FILTERS)).length, leagues.length);
  });

  test("editing the draft leaves the applied selection untouched", () => {
    // The controls write through `setDraft`, so what reaches them is a fresh
    // object per edit — an in-place write would apply the filter the moment it
    // was picked, which is the whole point of committing on Apply.
    const applied: LeagueFilters = { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex] };
    const before = structuredClone(applied);
    const edits: LeagueFilters[] = [];

    const tree = SegmentTrough({
      draft: applied,
      onChange: (next) => edits.push(next),
      leagues,
    });
    const [status] = elements(tree).filter((el) => typeof el.props.probe === "function");
    press(status, "onPick")("in_season");

    assert.equal(edits.length, 1);
    const [edited] = edits;
    assert.deepEqual(applied, before, "the applied selection is not written through");
    assert.notEqual(edited, applied, "and the edit is a new object");
    assert.equal(edited.status, "in_season");
    assert.deepEqual(edited.slots, applied.slots);
  });
});

describe("two of these dialogs on one page", () => {
  // A real state: the manager Leagues tab renders one in the header plate's
  // corner and the shares sheet opened from its rail renders a second.
  test("no id is written twice, and every reference still resolves", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(LeagueFiltersModal, {
          key: "a",
          filters: DEFAULT_LEAGUE_FILTERS,
          onChange: () => {},
          leagues,
        }),
        createElement(LeagueFiltersModal, {
          key: "b",
          filters: { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
          onChange: () => {},
          leagues,
          label: "Leagues",
        }),
      ),
    );

    const ids = Array.from(html.matchAll(/ id="([^"]*)"/g), (m) => m[1]);
    assert.ok(ids.length >= 4, "expected both dialogs to carry a title and a hint");
    assert.equal(new Set(ids).size, ids.length, "ids must be unique across both");

    // Two dialogs, two distinct labels, each landing on a heading of its own.
    const labelled = Array.from(html.matchAll(/aria-labelledby="([^"]*)"/g), (m) => m[1]);
    assert.equal(labelled.length, 2);
    assert.notEqual(labelled[0], labelled[1]);
    for (const target of labelled) {
      assert.ok(ids.includes(target), `aria-labelledby ${target} resolves to nothing`);
    }

    const described = Array.from(html.matchAll(/aria-describedby="([^"]*)"/g), (m) => m[1]);
    assert.equal(described.length, 2);
    assert.notEqual(described[0], described[1]);
  });
});
