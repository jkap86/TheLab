import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  comboboxActiveDescendant,
  comboboxListboxId,
  comboboxOptionId,
} from "../../shared/combobox.ts";
import { PlayerOptions, PlayerPicker } from "./player-picker.tsx";

import type { CompsPlayerOptionPayload } from "../types.ts";

/**
 * The picker's ARIA and its pointer wiring, without a DOM.
 *
 * **Two techniques, and the split between them is the honest limit of what can
 * be checked with no browser.** `renderToStaticMarkup` answers what is *in* the
 * markup — the roles, the ids, `aria-selected`, and above all what is
 * focusable, which is the whole of the bug this file was written for. Handlers
 * do not survive that, so the popup is also called as a plain function and its
 * element tree read back: `onClick`, `onMouseEnter` and the `mousedown` the
 * list swallows are asserted by *calling* them.
 *
 * What neither can reach is the field's own `useState`, so the picker itself is
 * only rendered shut. That is not a gap — the open state is `PlayerOptions`,
 * which is rendered here with the state spelled out, and the keyboard that
 * moves between them is `shared/combobox` and tested beside it.
 *
 * **The regression.** Every suggestion used to be a `<button>` inside its
 * `role="option"`, selecting on `pointerdown`. Three failures followed and not
 * one of them is visible on screen: twelve tab stops appeared between the
 * search box and the rest of the page; Enter on a focused suggestion fired a
 * `click` that nothing listened for, so the keyboard selected nothing at all;
 * and a finger dragging to scroll the list picked whatever it started on,
 * because `pointerdown` fires before a gesture is known to be a tap.
 */

const PLAYERS: CompsPlayerOptionPayload[] = [
  {
    player_id: "4034",
    name: "Christian McCaffrey",
    position: "RB",
    team: "SF",
    seasons: ["2025", "2024"],
  },
  {
    player_id: "6786",
    name: "Ja'Marr Chase",
    position: "WR",
    team: "CIN",
    seasons: ["2025"],
  },
  {
    player_id: "9509",
    name: "Puka Nacua",
    position: "WR",
    team: null,
    seasons: ["2025"],
  },
];

/** The picker as it sits on the page: shut, because nothing has been typed. */
const shut = (over: { loading?: boolean } = {}) =>
  renderToStaticMarkup(
    createElement(PlayerPicker, {
      players: PLAYERS,
      loading: over.loading ?? false,
      onSelect: () => {},
    }),
  );

const popupProps = (over: Partial<Parameters<typeof PlayerOptions>[0]> = {}) => ({
  id: comboboxListboxId("base"),
  baseId: "base",
  options: PLAYERS,
  activeIndex: 0,
  onPick: () => {},
  onHover: () => {},
  ...over,
});

const popup = (over: Partial<Parameters<typeof PlayerOptions>[0]> = {}) =>
  renderToStaticMarkup(createElement(PlayerOptions, popupProps(over)));

/**
 * Anything Tab can land on, as it appears in markup.
 *
 * Matched on the *tag* rather than on a role, because the failure is a control
 * that is focusable by being what it is — the nested `<button>` carried no role
 * at all. A positive or zero `tabindex` is the other way in.
 */
const FOCUSABLE = /<(button|a\s|a>|input|select|textarea|summary)|tabindex="(?!-)/g;

const focusables = (html: string): string[] => html.match(FOCUSABLE) ?? [];

/** Every element in a React tree, in document order. */
type Rendered = { type: unknown; props: Record<string, unknown> };

function elements(node: ReactNode, out: Rendered[] = []): Rendered[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const props = node.props as Record<string, unknown>;
  out.push({ type: node.type, props });
  elements(props.children as ReactNode, out);
  return out;
}

/** The popup's own element tree, handlers and all. */
const tree = (over: Partial<Parameters<typeof PlayerOptions>[0]> = {}) =>
  elements(PlayerOptions(popupProps(over)));

const optionRows = (over: Partial<Parameters<typeof PlayerOptions>[0]> = {}) =>
  tree(over).filter((el) => el.type === "li");

describe("the field is a combobox, shut", () => {
  test("it says what it is and that nothing is open", () => {
    const html = shut();
    assert.ok(html.includes('role="combobox"'));
    assert.ok(html.includes('aria-expanded="false"'));
    assert.ok(html.includes('aria-autocomplete="list"'));
    assert.ok(html.includes('aria-label="Search players"'));
  });

  test("it points at no popup and no option while there is none", () => {
    // A combobox permanently naming an id that was never rendered is a broken
    // relationship rather than a closed one, and it is the shape a picker falls
    // into the moment `aria-controls` is written unconditionally.
    const html = shut();
    assert.ok(!html.includes("aria-controls"));
    assert.ok(!html.includes("aria-activedescendant"));
    assert.ok(!html.includes('role="listbox"'));
    assert.ok(!html.includes('role="option"'));
  });

  test("the whole control is one tab stop", () => {
    // The count is the assertion: the field, and nothing else. Twelve
    // suggestions each carrying a `<button>` is what this replaces, and it is
    // invisible in review and invisible on screen.
    assert.deepEqual(focusables(shut()), ["<input"]);
  });

  test("a loading picker is still one tab stop, and a disabled one", () => {
    const html = shut({ loading: true });
    assert.deepEqual(focusables(html), ["<input"]);
    assert.ok(html.includes("disabled"));
  });
});

describe("the popup is a listbox of options and nothing else", () => {
  test("the list and its rows carry the roles the pattern names", () => {
    const html = popup();
    assert.ok(html.includes('role="listbox"'));
    assert.equal((html.match(/role="option"/g) ?? []).length, PLAYERS.length);
  });

  test("no part of it can take focus", () => {
    // The rule, stated as the absence it is: an option owning a focusable
    // descendant breaks `aria-activedescendant` outright, since the field only
    // names an active option while the field itself holds focus.
    assert.deepEqual(focusables(popup()), []);
    assert.ok(!popup().includes("<button"));
  });

  test("an option is identified by the player, so its id survives a re-rank", () => {
    const html = popup();
    for (const player of PLAYERS) {
      assert.ok(
        html.includes(`id="${comboboxOptionId("base", player.player_id)}"`),
        player.name,
      );
    }
    // Re-ranked under a new query, the same player answers to the same id.
    const reranked = popup({ options: [PLAYERS[2], PLAYERS[0]] });
    assert.ok(reranked.includes(`id="${comboboxOptionId("base", "9509")}"`));
  });

  test("exactly one option is marked, and it is the active one", () => {
    const html = popup({ activeIndex: 1 });
    assert.equal((html.match(/aria-selected="true"/g) ?? []).length, 1);
    assert.equal(
      (html.match(/aria-selected="false"/g) ?? []).length,
      PLAYERS.length - 1,
    );
    // The marked row is the one the field would be naming.
    const marked = html.split("<li").find((row) => row.includes('aria-selected="true"'));
    assert.ok(marked?.includes(comboboxOptionId("base", "6786")));
    assert.ok(marked?.includes("Ja&#x27;Marr Chase"));
  });

  test("what the field would publish is an id the popup really stamps", () => {
    // The one relationship in this whole control with no compiler link behind
    // it: a string on the field that has to match an `id` in the list. Spelled
    // at both ends it drifts into a reference naming nothing, which nobody
    // without a screen reader will ever see.
    for (const activeIndex of [0, 1, 2]) {
      const id = comboboxActiveDescendant(
        "base",
        PLAYERS,
        activeIndex,
        (player) => player.player_id,
      );
      assert.ok(id !== undefined);
      assert.ok(popup({ activeIndex }).includes(`id="${id}"`), `active ${activeIndex}`);
    }
  });

  test("the row still says everything it said before", () => {
    // The markup changed and the reading must not have: a position badge, the
    // name, and the team where there is one.
    const html = popup();
    assert.ok(html.includes(">RB<"));
    assert.ok(html.includes("Christian McCaffrey"));
    assert.ok(html.includes(">SF<"));
    // Puka Nacua has no stored team, and an absent team draws nothing at all
    // rather than an empty span holding a column open.
    const nacua = html.split("<li").find((row) => row.includes("Puka Nacua"));
    assert.ok(nacua);
    assert.equal((nacua.match(/text-foreground\/40/g) ?? []).length, 0);
  });
});

describe("what a press on a suggestion does", () => {
  test("a click on the option itself selects that player", () => {
    // The option *is* the control. Selection used to live on a `<button>`
    // inside it, which is what made Enter — a `click` — select nothing.
    const picked: CompsPlayerOptionPayload[] = [];
    const rows = optionRows({ onPick: (player) => picked.push(player) });
    assert.equal(rows.length, PLAYERS.length);

    (rows[1].props.onClick as () => void)();
    assert.deepEqual(picked, [PLAYERS[1]]);

    (rows[2].props.onClick as () => void)();
    assert.deepEqual(picked, [PLAYERS[1], PLAYERS[2]]);
  });

  test("the popup swallows mousedown, which is what lets the click land", () => {
    // Without it: `mousedown` moves focus off the field, the blur shuts the
    // popup, and the `click` that would have selected has no row left to land
    // on. This is the whole of "the popup does not close before the selection
    // registers", and it is one line in the component.
    let prevented = 0;
    const list = tree().find((el) => el.type === "ul");
    assert.ok(list);
    (list.props.onMouseDown as (e: { preventDefault: () => void }) => void)({
      preventDefault: () => (prevented += 1),
    });
    assert.equal(prevented, 1);
  });

  test("nothing in the popup acts on a raw pointer event", () => {
    // `pointerdown` fires before a gesture is known to be a tap, so selecting
    // there means a drag to scroll the list picks whatever it started on. The
    // compatibility `mousedown` above is only synthesised for a real tap, which
    // is why the fix is a `preventDefault` there and a `click` here.
    for (const el of tree()) {
      assert.equal(el.props.onPointerDown, undefined);
      assert.equal(el.props.onPointerUp, undefined);
      assert.equal(el.props.onTouchStart, undefined);
    }
  });

  test("hovering a row makes it the active option", () => {
    const hovered: number[] = [];
    const rows = optionRows({ onHover: (index) => hovered.push(index) });
    for (const row of rows) (row.props.onMouseEnter as () => void)();
    assert.deepEqual(hovered, [0, 1, 2]);
  });

  test("no row is a tab stop or claims to be a control", () => {
    for (const row of optionRows()) {
      assert.equal(row.props.tabIndex, undefined);
      assert.equal(row.props.role, "option");
    }
  });
});
