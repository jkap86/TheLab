import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  clampActiveIndex,
  comboboxActiveDescendant,
  comboboxKeyAction,
  comboboxKeydownHandler,
  comboboxListboxId,
  comboboxOptionId,
} from "./combobox.ts";

/**
 * The combobox's keyboard, without a DOM.
 *
 * **What is reachable here, and what is not.** Node's test runner has no
 * document and this repository takes no test-environment dependency — no jsdom,
 * no testing-library (see `AGENTS.md` and the same note on
 * `adp-drawer.focus.test.ts`) — so a real keypress on a real field cannot be
 * dispatched. That is exactly why the keyboard was pulled out of the picker's
 * handler and into `combobox.ts`: everything a press decides is a function
 * here, and the sessions below drive the *composed* handler in the order a
 * reader produces, against a list that narrows under them the way a search
 * does.
 *
 * What is left in the component is the wiring — `onKeyDown`, `onBlur`, and the
 * `mousedown` the popup swallows — and that is asserted in
 * `player-picker.render.test.ts`, which renders the markup and calls the
 * handlers off the element tree.
 *
 * Every rule below is one whose failure is **silent on screen**. A picker that
 * stops selecting on Enter, that swallows Tab, or that publishes an
 * `aria-activedescendant` naming nothing renders perfectly and reads perfectly
 * to anyone using a mouse.
 */

const state = (over: Partial<Parameters<typeof comboboxKeyAction>[1]> = {}) => ({
  open: true,
  activeIndex: 0,
  count: 5,
  ...over,
});

describe("where the active option can be", () => {
  test("an index inside the list is itself", () => {
    assert.equal(clampActiveIndex(3, 12), 3);
    assert.equal(clampActiveIndex(0, 1), 0);
  });

  test("an index past the end is the last option, not a hole", () => {
    // The case a search produces on every keystroke: the reader is on the sixth
    // suggestion and types a letter that leaves two.
    assert.equal(clampActiveIndex(5, 2), 1);
  });

  test("an empty list has no option to be on", () => {
    assert.equal(clampActiveIndex(4, 0), 0);
    assert.equal(clampActiveIndex(0, 0), 0);
  });

  test("a negative index is the first option", () => {
    assert.equal(clampActiveIndex(-1, 3), 0);
  });
});

describe("what a keypress means", () => {
  test("ArrowDown moves to the next option and spends the press", () => {
    // Unspent, the arrow would also run the caret to the end of the query.
    assert.deepEqual(comboboxKeyAction("ArrowDown", state({ activeIndex: 1 })), {
      type: "move",
      index: 2,
      consume: true,
    });
  });

  test("ArrowUp moves back", () => {
    assert.deepEqual(comboboxKeyAction("ArrowUp", state({ activeIndex: 3 })), {
      type: "move",
      index: 2,
      consume: true,
    });
  });

  test("the ends are walls rather than a ring", () => {
    // A wrap from the last suggestion to the first reads as the list jumping —
    // there is no scroll to explain it, since the popup is already at its end.
    assert.deepEqual(comboboxKeyAction("ArrowDown", state({ activeIndex: 4 })), {
      type: "move",
      index: 4,
      consume: true,
    });
    assert.deepEqual(comboboxKeyAction("ArrowUp", state({ activeIndex: 0 })), {
      type: "move",
      index: 0,
      consume: true,
    });
  });

  test("an arrow on a shut popup opens it and moves nothing", () => {
    // Advancing as well skips the first suggestion, which is both the likeliest
    // one and the one already highlighted — the reader would have to arrow back
    // up to reach what they were looking at.
    for (const key of ["ArrowDown", "ArrowUp"]) {
      assert.deepEqual(comboboxKeyAction(key, state({ open: false })), {
        type: "open",
        consume: true,
      });
    }
  });

  test("Enter chooses the active option", () => {
    assert.deepEqual(comboboxKeyAction("Enter", state({ activeIndex: 2 })), {
      type: "choose",
      index: 2,
      consume: true,
    });
  });

  test("Enter on a shut popup chooses nothing", () => {
    // The regression this pins: a picker reading its stored index without
    // asking whether anything is on screen selects out of an invisible list
    // one Escape after the reader dismissed it.
    assert.equal(comboboxKeyAction("Enter", state({ open: false })), null);
  });

  test("Enter chooses the option that is really there, not the stored index", () => {
    assert.deepEqual(comboboxKeyAction("Enter", state({ activeIndex: 9, count: 3 })), {
      type: "choose",
      index: 2,
      consume: true,
    });
  });

  test("Escape closes and spends the press", () => {
    assert.deepEqual(comboboxKeyAction("Escape", state()), {
      type: "close",
      consume: true,
    });
  });

  test("Escape on a shut popup is nobody's business here", () => {
    // Nothing is up to close, so the press is left for whatever is.
    assert.equal(comboboxKeyAction("Escape", state({ open: false })), null);
  });

  test("Tab closes and does NOT spend the press — the whole point", () => {
    // A combobox that consumed Tab would trap the reader inside the picker,
    // which is the bug this module exists to remove rather than relocate.
    assert.deepEqual(comboboxKeyAction("Tab", state()), {
      type: "close",
      consume: false,
    });
  });

  test("Tab with nothing open is left entirely alone", () => {
    assert.equal(comboboxKeyAction("Tab", state({ open: false })), null);
  });

  test("both dismissals answer before the count, so an empty popup still shuts", () => {
    assert.deepEqual(comboboxKeyAction("Escape", state({ count: 0 })), {
      type: "close",
      consume: true,
    });
    assert.deepEqual(comboboxKeyAction("Tab", state({ count: 0 })), {
      type: "close",
      consume: false,
    });
  });

  test("with nothing to show, the arrows and Enter are not the combobox's keys", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Enter"]) {
      assert.equal(comboboxKeyAction(key, state({ count: 0 })), null, key);
    }
  });

  test("a text field's own keys are never taken over", () => {
    // Home and End move the caret through the query and Space types one, so a
    // combobox claiming the listbox pattern's keys could not edit what it is
    // searching for. `Esc` is the legacy spelling and is deliberately not `Escape`.
    for (const key of ["Home", "End", " ", "a", "Backspace", "PageDown", "Esc"]) {
      assert.equal(comboboxKeyAction(key, state()), null, key);
    }
  });
});

/**
 * The composed handler, driven the way a reader drives it.
 *
 * The list narrows between presses, as a search's does, and the harness holds
 * the same state the picker holds — so what these assert is the sequence rather
 * than the individual answers already covered above.
 */
function session(options: string[]) {
  let open = false;
  let activeIndex = 0;
  let current = options;
  const chosen: string[] = [];
  let prevented = 0;

  const handler = comboboxKeydownHandler<string>({
    isOpen: () => open && current.length > 0,
    options: () => current,
    activeIndex: () => activeIndex,
    onOpen: () => {
      open = true;
    },
    onActivate: (index) => {
      activeIndex = index;
    },
    onChoose: (option) => {
      chosen.push(option);
      // What the picker does on a pick: the query is cleared and the popup shuts.
      open = false;
      activeIndex = 0;
    },
    onClose: () => {
      open = false;
    },
  });

  return {
    get open() {
      return open && current.length > 0;
    },
    get activeIndex() {
      return activeIndex;
    },
    get chosen() {
      return chosen;
    },
    get prevented() {
      return prevented;
    },
    /** Typing: the list narrows, the popup opens, the highlight goes home. */
    type(next: string[]) {
      current = next;
      activeIndex = 0;
      open = true;
    },
    press(key: string) {
      handler({ key, preventDefault: () => (prevented += 1) });
    },
  };
}

const NAMES = ["Bijan Robinson", "Ja'Marr Chase", "Chase Brown", "A.J. Brown"];

describe("a reader at the keyboard", () => {
  test("type, ArrowDown, Enter selects the second suggestion", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Ja'Marr Chase"]);
    assert.equal(s.open, false, "and the popup is shut behind it");
  });

  test("type, Enter selects the first suggestion without arrowing at all", () => {
    // The highlight starts on the first row, so the fastest path through the
    // picker is two keys — and `aria-activedescendant` says so before Enter.
    const s = session(NAMES);
    s.type(NAMES);
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Bijan Robinson"]);
  });

  test("ArrowDown three times lands on the fourth", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    s.press("ArrowDown");
    s.press("ArrowDown");
    assert.equal(s.activeIndex, 3);
    s.press("Enter");
    assert.deepEqual(s.chosen, ["A.J. Brown"]);
  });

  test("arrowing past the end holds, and back up walks off it", () => {
    const s = session(NAMES);
    s.type(NAMES);
    for (let i = 0; i < 9; i += 1) s.press("ArrowDown");
    assert.equal(s.activeIndex, 3);
    s.press("ArrowUp");
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Chase Brown"]);
  });

  test("Escape closes, and Enter after it selects nothing", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    s.press("Escape");
    assert.equal(s.open, false);
    s.press("Enter");
    assert.deepEqual(s.chosen, [], "nothing is chosen out of a shut popup");
  });

  test("an arrow after Escape brings the popup back where it was", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    s.press("ArrowDown");
    s.press("Escape");
    s.press("ArrowDown");
    assert.equal(s.open, true);
    assert.equal(s.activeIndex, 2, "reopened on the option it was dismissed on");
  });

  test("Tab closes the popup and leaves the press for the browser", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    const spent = s.prevented;
    s.press("Tab");
    assert.equal(s.open, false, "the popup does not outlive the field's focus");
    assert.equal(s.prevented, spent, "and focus moves on as it would anywhere");
    assert.deepEqual(s.chosen, [], "Tab commits nothing it was not asked to");
  });

  test("Shift+Tab is the same press backwards, and nothing here reads shift", () => {
    // The direction is the browser's business precisely because the press is
    // not consumed — which is what makes backwards behave without a second rule.
    const s = session(NAMES);
    s.type(NAMES);
    const spent = s.prevented;
    s.press("Tab");
    assert.equal(s.open, false);
    assert.equal(s.prevented, spent);
  });

  test("a query narrowing under the highlight cannot select the wrong player", () => {
    // The index outlives the list it was chosen against. Held unclamped, Enter
    // here reads past the end and selects nothing — or, worse, reads a stale
    // list and selects somebody the reader is no longer looking at.
    const s = session(NAMES);
    s.type(NAMES);
    s.press("ArrowDown");
    s.press("ArrowDown");
    s.press("ArrowDown");
    assert.equal(s.activeIndex, 3);

    // "chase" — two left, and the reader's index is past both.
    const narrowed = ["Ja'Marr Chase", "Chase Brown"];
    s.type(narrowed);
    assert.equal(s.activeIndex, 0);
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Ja'Marr Chase"]);
  });

  test("a search matching nothing answers no key at all", () => {
    const s = session(NAMES);
    s.type([]);
    for (const key of ["ArrowDown", "ArrowUp", "Enter"]) s.press(key);
    assert.deepEqual(s.chosen, []);
    assert.equal(s.prevented, 0, "and every press is left to the text field");
  });

  test("the options are re-read per press, not captured when the handler was built", () => {
    // A picker re-creates the handler each render, so this is a property of the
    // module rather than of that call site — and it is what keeps the same
    // implementation correct for a caller that wires it once.
    const s = session(NAMES);
    s.type(NAMES);
    s.type(["Puka Nacua"]);
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Puka Nacua"]);
  });

  test("choosing twice takes two openings, not one", () => {
    const s = session(NAMES);
    s.type(NAMES);
    s.press("Enter");
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Bijan Robinson"], "the shut popup answers nothing");
    s.type(NAMES);
    s.press("Enter");
    assert.deepEqual(s.chosen, ["Bijan Robinson", "Bijan Robinson"]);
  });
});

describe("the ids the field and the popup have to agree on", () => {
  const players = [
    { player_id: "4034", name: "Christian McCaffrey" },
    { player_id: "6786", name: "Ja'Marr Chase" },
    { player_id: "SF", name: "49ers" },
  ];
  const keyOf = (p: { player_id: string }) => p.player_id;

  test("the popup's id hangs off the field's own base", () => {
    assert.equal(comboboxListboxId("«r7»"), "«r7»-listbox");
  });

  test("an option is identified by what it is, never by where it sits", () => {
    // A positional id is a different suggestion on every keystroke, so an
    // assistive technology caching by id is told the fourth row changed name
    // rather than that the list was replaced.
    assert.equal(comboboxOptionId("«r7»", "6786"), "«r7»-option-6786");
    assert.notEqual(comboboxOptionId("«r7»", "6786"), comboboxOptionId("«r7»", "4034"));
  });

  test("an option keeps its id as the list re-ranks around it", () => {
    const before = comboboxOptionId("«r7»", players[1].player_id);
    const reranked = [players[1], players[0]];
    assert.equal(comboboxOptionId("«r7»", reranked[0].player_id), before);
  });

  test("the active descendant is the active option's own id", () => {
    assert.equal(
      comboboxActiveDescendant("«r7»", players, 1, keyOf),
      comboboxOptionId("«r7»", "6786"),
    );
  });

  test("it names the option really shown when the index is stale", () => {
    assert.equal(
      comboboxActiveDescendant("«r7»", players.slice(0, 2), 7, keyOf),
      comboboxOptionId("«r7»", "6786"),
    );
  });

  test("no options is an absent attribute, not a reference to nothing", () => {
    // `aria-activedescendant=""` is a reference that fails; absent is the
    // honest spelling of "no active option".
    assert.equal(comboboxActiveDescendant("«r7»", [], 0, keyOf), undefined);
  });

  test("the two ends cannot be spelled differently, which is why they share a builder", () => {
    // The relationship an `aria-activedescendant` rests on is a string match
    // with no compiler link behind it — the failure is a reference naming
    // nothing, which is invisible to everyone not using a screen reader.
    for (const [index, player] of players.entries()) {
      assert.equal(
        comboboxActiveDescendant("«r7»", players, index, keyOf),
        comboboxOptionId("«r7»", player.player_id),
      );
    }
  });
});
