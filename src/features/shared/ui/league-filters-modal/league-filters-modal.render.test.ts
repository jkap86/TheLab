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
  SLOT_GROUPS,
  STATUS_OPTIONS,
  activeFilterCount,
  matchesFilters,
  matchesSlotRule,
} from "../../league-filters/index.ts";
import type { ManagerLeague } from "@/shared/manager";

import { FiltersDialogFooter } from "./filters-dialog-footer.tsx";
import { FiltersDialogHeader } from "./filters-dialog-header.tsx";
import { FiltersTrigger } from "./filters-trigger.tsx";
import { LeagueFiltersModal } from "./league-filters-modal.tsx";
import { SLOT_PRESETS } from "./league-filters-modal.constants.ts";
import type { SegmentKey } from "./league-filters-modal.types.ts";
import { RuleBay } from "./rule-bay.tsx";
import { SegmentRow } from "./segment-row.tsx";
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
 * The **open** segment popover is the state worth naming here: it is unreachable
 * through the modal (nothing can press a row without a document), so it is
 * reached by rendering `SegmentRow` with `open` set. That is the branch carrying
 * the panel's animation, its option keys and their counts.
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

/**
 * The status row on its own, which is the only way to reach the **open**
 * popover: nothing can press a row without a document, so the modal always
 * renders it closed.
 */
function statusRow(open: boolean, value: LeagueFilters["status"] = "all"): string {
  return renderToStaticMarkup(
    createElement(SegmentRow, {
      label: "Status",
      options: STATUS_OPTIONS,
      value: value as string,
      leagues,
      probe: (next: string) => ({
        ...DEFAULT_LEAGUE_FILTERS,
        status: next as LeagueFilters["status"],
      }),
      onPick: () => {},
      open,
      onToggle: () => {},
      onClose: () => {},
    }),
  );
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

  test("the panel plays its entrance, and the popover its own", () => {
    assert.match(modal(), /animation:dialog-rise 0\.18s cubic-bezier\(0\.2,0\.9,0\.3,1\)/);
    assert.match(modal(), /filters-dialog-panel/);
    // Both classes are named in the reduced-motion block in `globals.css`, which
    // is what freezes them — so the class names are the contract, not decoration.
    const open = statusRow(true);
    assert.match(open, /filters-segment-pop/);
    assert.match(open, /animation:dialog-rise 0\.14s cubic-bezier\(0\.2,0\.9,0\.3,1\)/);
    // Closed, neither the panel nor its animation is in the tree at all.
    assert.doesNotMatch(statusRow(false), /filters-segment-pop/);
  });

  test("a collapsed row states its selection, its count and its expanded state", () => {
    const html = modal();
    assert.match(html, /aria-expanded="false"/);
    // **No `aria-haspopup`**, which this used to assert. What a row opens is a
    // list of radio-ish keys, not a menu, and `haspopup="true"` *means* menu —
    // `expanded` plus `controls` is the disclosure this actually is. The
    // reference is asserted where the popup exists, in the open case below.
    assert.doesNotMatch(html, /aria-haspopup="true"/);
    for (const label of ["Status", "Type", "Format"]) {
      assert.ok(html.includes(`>${label}</span>`), `expected a ${label} row`);
    }
    // The unnarrowed selection, named in the same words the header uses.
    assert.match(html, /Any status/);
    assert.match(html, /All types/);
    assert.match(html, /All formats/);
  });

  test("an open row lists every option, marked and counted", () => {
    const html = statusRow(true, "in_season");
    for (const option of STATUS_OPTIONS) {
      assert.ok(html.includes(option.label), `expected ${option.label} on the menu`);
    }
    // Exactly one option is pressed, and the counts are probed against the draft.
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.equal((html.match(/aria-pressed="false"/g) ?? []).length, STATUS_OPTIONS.length - 1);
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

  test("both empty bays say what a rule there would do", () => {
    const html = modal();
    assert.match(html, /Any lineup\. Add a rule to narrow by what a league starts\./);
    assert.match(html, /Any scoring\. Add a rule to narrow by what a league pays\./);
  });

  test("the footer states the count for the width the rail is stacked at", () => {
    const html = modal();
    assert.match(html, /lg:hidden/);
    assert.match(html, /Every filter narrows — a league has to pass all of them\./);
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
  test("picking a segment option writes that one field and closes the row", () => {
    let next: LeagueFilters | null = null;
    let closed = 0;
    const tree = SegmentTrough({
      troughRef: { current: null },
      draft: { ...DEFAULT_LEAGUE_FILTERS, type: "2" },
      onChange: (value) => {
        next = value;
      },
      leagues,
      openGroup: "status",
      onToggle: () => {},
      onClose: () => {
        closed += 1;
      },
    });
    const rows = elements(tree).filter((el) => typeof el.props.probe === "function");
    assert.equal(rows.length, 3);
    press(rows[0], "onPick")("pre_draft");
    // The rest of the draft survives — a row edits its own field and no other.
    assert.deepEqual(next, { ...DEFAULT_LEAGUE_FILTERS, type: "2", status: "pre_draft" });
    assert.equal(closed, 0, "closing is the row's own business, on its onClose");
  });

  test("each row reports its own key when toggled", () => {
    const toggled: SegmentKey[] = [];
    const tree = SegmentTrough({
      troughRef: { current: null },
      draft: DEFAULT_LEAGUE_FILTERS,
      onChange: () => {},
      leagues,
      openGroup: null,
      onToggle: (key) => toggled.push(key),
      onClose: () => {},
    });
    for (const row of elements(tree).filter((el) => typeof el.props.probe === "function")) {
      press(row, "onToggle")();
    }
    assert.deepEqual(toggled, ["status", "type", "format"]);
  });

  test("a row's probe describes the whole draft with one field changed", () => {
    const draft: LeagueFilters = { ...DEFAULT_LEAGUE_FILTERS, slots: [superflex] };
    const tree = SegmentTrough({
      troughRef: { current: null },
      draft,
      onChange: () => {},
      leagues,
      openGroup: null,
      onToggle: () => {},
      onClose: () => {},
    });
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
      FiltersDialogFooter({
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

  test("nothing is floating on arrival", () => {
    // A row left open from last time would cover the rule bays the moment the
    // dialog reappeared.
    assert.equal(mountHook(DEFAULT_LEAGUE_FILTERS).openGroup, null);
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
      troughRef: { current: null },
      draft: applied,
      onChange: (next) => edits.push(next),
      leagues,
      openGroup: null,
      onToggle: () => {},
      onClose: () => {},
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
