import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ADP_DRAWER_ENTER_MS, ADP_DRAWER_EXIT_MS } from "./adp-drawer.constants.ts";
import {
  TABBABLE_SELECTOR,
  deferFocusRestore,
  drawerKeyAction,
  drawerKeydownHandler,
  isTabbable,
  lockScroll,
  releaseFocusRestore,
  restoreFocus,
  resumeFocusRestore,
  tabWrap,
  tabbableStops,
} from "./adp-drawer.focus.ts";

/**
 * The drawer's modal behaviour, tested without a DOM.
 *
 * **What is reachable here, and what is not.** Node's test runner has no
 * document and this repository takes no test-environment dependency (no jsdom,
 * no testing-library — see `AGENTS.md`), so a React *effect* cannot be made to
 * run: `renderToStaticMarkup` produces markup and never mounts. That is the
 * whole of the limitation, and it is why the drawer's keyboard rules were pulled
 * out of the effect they used to live in. Everything the effect decides — which
 * key means what, where Tab goes next, whether an opener may be focused again,
 * what the scroll lock restores — is a function here and is covered below,
 * against fakes standing in for the elements.
 *
 * What is left in `use-adp-drawer-lifecycle` is the wiring those functions are
 * bolted to: `addEventListener`/`removeEventListener`, `setTimeout`/
 * `clearTimeout`, and reading `document.activeElement`. Those cannot be asserted
 * without a browser, and the risk they carry is bounded by their being React's
 * own idiom — each is a single-line effect whose cleanup is the exact inverse of
 * its setup. The drawer's *markup* contract (dialog role, modal flag, accessible
 * name, and that the panel really does contain tab stops for the trap to find)
 * is asserted in `adp-drawer.render.test.ts`, which does render it.
 *
 * **The focus handback is the case that pushed hardest on that line, and where
 * it ended up is worth knowing.** *When* it happens is a fact about the hook's
 * effects and is out of reach here; *what happens at each step* is the three
 * slot moves below, and those are the whole of the arithmetic. The last two
 * suites drive them through `drive`, which spells the hook's transitions — the
 * open effect's setup, its cleanup, the off-screen release — in the hook's own
 * order, including the order *inside* the open effect that the interrupted-exit
 * fix turns on. So the properties that matter are asserted rather than
 * described: nothing is focused until the drawer is off screen, and the element
 * that opened the drawer from the page stays the restoration target however many
 * exits are interrupted on the way.
 *
 * They need no timers, fake or otherwise. The exit's duration decides *when* the
 * release runs and never *what* it does, so a test that waited one out would be
 * asserting `setTimeout` — which is why the sequences are driven by calling the
 * transitions rather than by advancing a clock. What is genuinely left to a
 * browser is that the hook calls them on those transitions and not others, and
 * the exit timer's own `clearTimeout`.
 */

type FakeState = {
  isConnected: boolean;
  disabled: boolean;
  inert: boolean;
  uneditable: boolean;
  tabindex: string | null;
  rects: number;
  throwOnFocus: boolean;
};

type Fake = FakeState & {
  readonly id: string;
  focusCount: number;
  matches: (selectors: string) => boolean;
  getAttribute: (name: string) => string | null;
  getClientRects: () => { length: number };
  focus: () => void;
};

function fake(id: string, over: Partial<FakeState> = {}): Fake {
  const node: Fake = {
    id,
    isConnected: true,
    disabled: false,
    inert: false,
    uneditable: false,
    tabindex: null,
    rects: 1,
    throwOnFocus: false,
    ...over,
    focusCount: 0,
    matches: (selectors) => {
      if (selectors === ":disabled") return node.disabled;
      if (selectors === "[inert], [inert] *") return node.inert;
      if (selectors === '[contenteditable="false"]') return node.uneditable;
      return false;
    },
    getAttribute: (name) => (name === "tabindex" ? node.tabindex : null),
    getClientRects: () => ({ length: node.rects }),
    focus: () => {
      if (node.throwOnFocus) throw new Error("refused");
      node.focusCount += 1;
    },
  };
  return node;
}

describe("which elements Tab can land on", () => {
  test("an ordinary rendered control is a stop", () => {
    assert.equal(isTabbable(fake("a")), true);
  });

  test("a negative tabindex opts out — which is what the dialog panel carries", () => {
    assert.equal(isTabbable(fake("panel", { tabindex: "-1" })), false);
    // Any negative value, not just the conventional -1.
    assert.equal(isTabbable(fake("odd", { tabindex: "-2" })), false);
    // Zero and positive are opting *in*.
    assert.equal(isTabbable(fake("zero", { tabindex: "0" })), true);
    assert.equal(isTabbable(fake("pos", { tabindex: "3" })), true);
  });

  test("disabled and inert are not stops", () => {
    assert.equal(isTabbable(fake("d", { disabled: true })), false);
    assert.equal(isTabbable(fake("i", { inert: true })), false);
  });

  test("a contenteditable=\"false\" host matches the selector and is not a stop", () => {
    assert.equal(isTabbable(fake("c", { uneditable: true })), false);
  });

  test("no client rects is how display:none reads from here", () => {
    assert.equal(isTabbable(fake("hidden", { rects: 0 })), false);
  });

  test("the stops keep document order, which is the order Tab visits them", () => {
    const nodes = [
      fake("one"),
      fake("skipped", { disabled: true }),
      fake("two"),
      fake("gone", { rects: 0 }),
      fake("three"),
    ];
    assert.deepEqual(
      tabbableStops(nodes).map((n) => n.id),
      ["one", "two", "three"],
    );
  });

  test("the selector names every kind of control the drawer actually renders", () => {
    // The drawer is keys (`button`), filter chips (`select`), and the lookback
    // counter's fields (`input`). A selector that stopped naming one of these
    // would silently shrink the trap rather than fail.
    for (const kind of ["button", "select", "input", "textarea", "a[href]", "[tabindex]"]) {
      assert.ok(
        TABBABLE_SELECTOR.split(",").includes(kind),
        `${kind} should be a tabbable candidate`,
      );
    }
  });
});

describe("where Tab goes next", () => {
  test("the last stop wraps to the first, and the first back to the last", () => {
    assert.equal(tabWrap(3, 2, false), 0);
    assert.equal(tabWrap(3, 0, true), 2);
  });

  test("mid-list the browser is left to do it", () => {
    assert.equal(tabWrap(3, 1, false), null);
    assert.equal(tabWrap(3, 1, true), null);
    assert.equal(tabWrap(4, 2, false), null);
  });

  test("focus outside the dialog is pulled back in at the near end", () => {
    // -1 is focus on the panel itself, on the scrim, or on the page behind.
    assert.equal(tabWrap(3, -1, false), 0);
    assert.equal(tabWrap(3, -1, true), 2);
    // An index past the end is the same answer — a stale read, not a location.
    assert.equal(tabWrap(3, 9, false), 0);
  });

  test("a dialog with nothing tabbable keeps focus on itself", () => {
    assert.equal(tabWrap(0, -1, false), "container");
    assert.equal(tabWrap(0, -1, true), "container");
  });

  test("a single stop holds focus in both directions", () => {
    assert.equal(tabWrap(1, 0, false), 0);
    assert.equal(tabWrap(1, 0, true), 0);
  });
});

describe("what a keypress means", () => {
  test("Escape closes the innermost thing that is up", () => {
    // Two answers, and which one applies is the whole of the rule: a bay is a
    // plain floating panel over the board — it cannot be a `<dialog>`, since a
    // modal one would make the board inert and the board is what a bay exists to
    // be watched against — so the routing past it is this handler's again.
    assert.deepEqual(drawerKeyAction("Escape", false, true), { type: "close-bay" });
    assert.deepEqual(drawerKeyAction("Escape", false, false), {
      type: "close-drawer",
    });
  });

  test("the league-filters dialog needs no ordering against either", () => {
    // It is a real `<dialog>` in the top layer, so while it is open the press
    // never arrives here at all — which is what makes "innermost" resolve
    // dialog, then bay, then drawer without this function knowing it exists.
    // The rule that keeps that true is that a bay is *not* one of those, which
    // the two answers above are the consequence of.
    assert.notEqual(drawerKeyAction("Escape", false, true), null);
  });

  test("Tab carries its direction, whatever is up", () => {
    for (const bayOpen of [false, true]) {
      // A bay is inside the dialog, so the trap's boundary is unchanged by one
      // being open — Tab runs through the bay's own controls as part of the
      // drawer's sequence rather than being held inside the bay.
      assert.deepEqual(drawerKeyAction("Tab", false, bayOpen), {
        type: "trap-tab",
        backwards: false,
      });
      assert.deepEqual(drawerKeyAction("Tab", true, bayOpen), {
        type: "trap-tab",
        backwards: true,
      });
    }
  });

  test("every other key is none of the drawer's business", () => {
    for (const key of ["a", "Enter", " ", "ArrowDown", "Home", "Esc"]) {
      assert.equal(drawerKeyAction(key, false, false), null);
      assert.equal(drawerKeyAction(key, false, true), null);
    }
  });
});

describe("the composed keydown handler", () => {
  function harness(stops: Fake[][]) {
    const log: string[] = [];
    let active: Fake | null = null;
    let press = 0;
    let prevented = 0;
    // Whether a bay is up is read *per press* rather than captured, which is the
    // property the two Escapes below are actually checking: a reader opens and
    // shuts bays between presses, and a handler holding the answer from wiring
    // time would take the drawer down from under an open one.
    let bayOpen = false;
    const handler = drawerKeydownHandler<Fake>({
      stops: () => stops[Math.min(press, stops.length - 1)],
      activeElement: () => active,
      focusContainer: () => log.push("container"),
      bayOpen: () => bayOpen,
      closeBay: () => {
        log.push("close-bay");
        bayOpen = false;
      },
      closeDrawer: () => log.push("close-drawer"),
    });
    return {
      log,
      get prevented() {
        return prevented;
      },
      openBay() {
        bayOpen = true;
      },
      focusOn(node: Fake | null) {
        active = node;
      },
      send(key: string, shiftKey = false) {
        handler({ key, shiftKey, preventDefault: () => (prevented += 1) });
        press += 1;
      },
    };
  }

  test("two Escapes close the bay and then the drawer, in that order", () => {
    // The one sequence a captured flag gets wrong: the first press shuts the
    // bay, and the second has to find it shut and take the drawer.
    const h = harness([[fake("a"), fake("b")]]);
    h.openBay();
    h.send("Escape");
    h.send("Escape");
    assert.deepEqual(h.log, ["close-bay", "close-drawer"]);
  });

  test("Escape reaches the drawer", () => {
    const h = harness([[fake("a"), fake("b")]]);
    h.send("Escape");
    assert.deepEqual(h.log, ["close-drawer"]);
  });

  test("Tab off the last stop wraps to the first and consumes the press", () => {
    const stops = [fake("a"), fake("b"), fake("c")];
    const h = harness([stops]);
    h.focusOn(stops[2]);
    h.send("Tab");
    assert.equal(stops[0].focusCount, 1);
    assert.equal(h.prevented, 1);
  });

  test("Shift+Tab off the first stop wraps to the last", () => {
    const stops = [fake("a"), fake("b"), fake("c")];
    const h = harness([stops]);
    h.focusOn(stops[0]);
    h.send("Tab", true);
    assert.equal(stops[2].focusCount, 1);
    assert.equal(h.prevented, 1);
  });

  test("mid-list the press is left alone — nothing focused, nothing prevented", () => {
    const stops = [fake("a"), fake("b"), fake("c")];
    const h = harness([stops]);
    h.focusOn(stops[1]);
    h.send("Tab");
    assert.deepEqual(stops.map((s) => s.focusCount), [0, 0, 0]);
    assert.equal(h.prevented, 0);
  });

  test("focus outside the dialog is pulled back in — the trap's whole point", () => {
    const stops = [fake("a"), fake("b")];
    const h = harness([stops]);
    // The scrim, or anything on the page behind the drawer.
    h.focusOn(fake("elsewhere"));
    h.send("Tab");
    assert.equal(stops[0].focusCount, 1);
    assert.equal(h.prevented, 1);

    h.focusOn(null);
    h.send("Tab", true);
    assert.equal(stops[1].focusCount, 1);
  });

  test("a dialog holding no stops keeps focus on itself", () => {
    const h = harness([[]]);
    h.focusOn(null);
    h.send("Tab");
    assert.deepEqual(h.log, ["container"]);
    assert.equal(h.prevented, 1);
  });

  test("the stops are re-read per press, not captured when the listener was wired", () => {
    // Opening the filter tray adds six selects under a listener attached on
    // open. A handler closing over the first list would trap the reader outside
    // the control they just opened.
    const before = [fake("trigger")];
    const after = [fake("trigger"), fake("chip-1"), fake("chip-2")];
    const h = harness([before, after]);

    h.focusOn(before[0]);
    h.send("Tab"); // sole stop: holds itself
    assert.equal(before[0].focusCount, 1);

    h.focusOn(after[2]);
    h.send("Tab"); // now the last of three, so it wraps to the new first
    assert.equal(after[0].focusCount, 1);
  });

  test("an unrelated key touches nothing", () => {
    const stops = [fake("a")];
    const h = harness([stops]);
    h.focusOn(stops[0]);
    h.send("ArrowDown");
    assert.deepEqual(h.log, []);
    assert.equal(stops[0].focusCount, 0);
    assert.equal(h.prevented, 0);
  });
});

describe("handing focus back on the way out", () => {
  test("the opener gets it", () => {
    const trigger = fake("trigger");
    assert.equal(restoreFocus(trigger), true);
    assert.equal(trigger.focusCount, 1);
  });

  test("nothing captured is nothing to restore", () => {
    assert.equal(restoreFocus(null), false);
  });

  test("an element that no longer exists is left alone", () => {
    // Focusing a detached node drops the reader on <body>, which is worse than
    // leaving focus where it is.
    const gone = fake("gone", { isConnected: false });
    assert.equal(restoreFocus(gone), false);
    assert.equal(gone.focusCount, 0);
  });

  test("a disabled element is left alone", () => {
    const off = fake("reloading", { disabled: true });
    assert.equal(restoreFocus(off), false);
    assert.equal(off.focusCount, 0);
  });

  test("an inert element is left alone", () => {
    // Inertness inherits, so this covers a trigger whose whole subtree went
    // inert under it as well as one wearing the attribute itself.
    const inert = fake("under-a-modal", { inert: true });
    assert.equal(restoreFocus(inert), false);
    assert.equal(inert.focusCount, 0);
  });

  test("an element that is no longer displayed is left alone", () => {
    // The app bar's seat empties at some widths, and focusing a `display: none`
    // element is a call that silently does nothing — which reads to the caller
    // as a handback that landed.
    const hidden = fake("collapsed", { rects: 0 });
    assert.equal(restoreFocus(hidden), false);
    assert.equal(hidden.focusCount, 0);
  });

  test("a negative tabindex is not a refusal — a focus target is not a tab stop", () => {
    // The one check `isTabbable` makes that this must not: a trigger opting out
    // of the tab sequence is still exactly where focus belongs on the way out.
    const target = fake("programmatic", { tabindex: "-1" });
    assert.equal(isTabbable(target), false);
    assert.equal(restoreFocus(target), true);
    assert.equal(target.focusCount, 1);
  });

  test("a refusal is swallowed rather than thrown at the caller", () => {
    // This runs inside a keydown handler; an exception here would take the
    // Escape that asked for it with it.
    const hostile = fake("hostile", { throwOnFocus: true });
    assert.equal(restoreFocus(hostile), false);
  });
});

/**
 * The two slots the lifecycle hook holds, as the hook holds them: `opener` while
 * the drawer is up, `pending` from the moment closing begins until the exit has
 * played out. The bug these replaced was one slot spent in the `open` effect's
 * cleanup — which runs the instant `open` goes false, while the panel is still
 * mounted, still visible and still `aria-modal="true"`.
 */
const slots = () => ({
  opener: { current: null as Fake | null },
  pending: { current: null as Fake | null },
});

type Slots = ReturnType<typeof slots>;

/**
 * The hook's transitions, spelled exactly as `use-adp-drawer-lifecycle` spells
 * them — including the **order** inside the open effect, which is the whole of
 * the interrupted-exit fix. Driving the sequences through these rather than
 * through the primitives directly is what makes the tests below assert the
 * hook's arithmetic and not a rearrangement of it.
 */
const drive = {
  /**
   * The `open` effect's setup. `activeElement` is what the browser would report
   * at that moment: the page's trigger on a fresh open, and a control *inside
   * the closing drawer* on a reopen mid-exit — which is why the pending slot is
   * asked first and the capture only happens when it is empty.
   */
  open(s: Slots, activeElement: Fake | null) {
    if (!resumeFocusRestore(s.opener, s.pending)) s.opener.current = activeElement;
  },
  /** The `open` effect's cleanup: the handback becomes owed, and is not paid. */
  close(s: Slots) {
    deferFocusRestore(s.opener, s.pending);
  },
  /** The `onScreen` effect, once the exit has played out. */
  exit(s: Slots) {
    return releaseFocusRestore(s.pending);
  },
};

describe("when the handback happens, which is not when the drawer closes", () => {
  test("closing owes the handback; it does not pay it", () => {
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;

    deferFocusRestore(opener, pending);
    // The whole of the fix: the trigger has been *recorded*, and nothing on the
    // page behind has been focused while the drawer is still on screen.
    assert.equal(trigger.focusCount, 0);
    assert.equal(opener.current, null, "the open slot is emptied as it hands over");
    assert.equal(pending.current, trigger);
  });

  test("the exit finishing is what pays it", () => {
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;

    deferFocusRestore(opener, pending);
    assert.equal(releaseFocusRestore(pending), true);
    assert.equal(trigger.focusCount, 1);
  });

  test("nothing pending is nothing to resume, so an ordinary open captures", () => {
    const { opener, pending } = slots();
    assert.equal(resumeFocusRestore(opener, pending), false);
    assert.equal(opener.current, null, "and it leaves the opener for the caller to fill");
  });

  test("a pending target is promoted rather than spent", () => {
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;
    deferFocusRestore(opener, pending);

    assert.equal(resumeFocusRestore(opener, pending), true);
    assert.equal(opener.current, trigger, "back in the slot the next close defers from");
    assert.equal(pending.current, null, "and no longer owed");
    assert.equal(trigger.focusCount, 0, "promoting is not paying");
  });

  test("paying twice is a no-op — the off-screen beat and the unmount share a slot", () => {
    // Both the `onScreen` effect and the mount-lifetime cleanup can reach the
    // release, and on an ordinary close both do. The second must not re-focus a
    // trigger the reader has since moved away from.
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;
    deferFocusRestore(opener, pending);

    assert.equal(releaseFocusRestore(pending), true);
    assert.equal(releaseFocusRestore(pending), false);
    assert.equal(trigger.focusCount, 1);
  });

  test("deferring twice cannot lose the target", () => {
    // The `open` effect's cleanup runs once per close, but a drawer unmounted
    // while open runs it beside the mount-lifetime cleanup — and an unguarded
    // move would overwrite the pending trigger with the empty opener slot.
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;

    deferFocusRestore(opener, pending);
    deferFocusRestore(opener, pending);
    assert.equal(pending.current, trigger);
  });

  test("an unmount while open still hands focus back", () => {
    // Nothing transitions `onScreen` here — the component is gone — so the
    // focused element goes with it and the reader is left on `<body>`. The
    // mount-lifetime cleanup is what covers it.
    const { opener, pending } = slots();
    const trigger = fake("trigger");
    opener.current = trigger;

    deferFocusRestore(opener, pending); // the `open` effect's cleanup
    releaseFocusRestore(pending); // the mount-lifetime cleanup, declared after it
    assert.equal(trigger.focusCount, 1);
  });

  test("nothing owed is nothing paid, so a drawer that never opened is silent", () => {
    const { pending } = slots();
    assert.equal(releaseFocusRestore(pending), false);
  });

  // An opener is a reference held across the whole life of the drawer, so by
  // the time the exit spends it the trigger may be none of the things it was.
  // Each of these is `restoreFocus`'s own refusal reached through the slots,
  // which is the path the hook actually takes — and each asserts the slot is
  // emptied anyway, so a refused handback is not retried on the next close.
  for (const [what, state] of [
    ["gone from the DOM", { isConnected: false }],
    ["disabled", { disabled: true }],
    ["inert", { inert: true }],
    ["no longer displayed", { rects: 0 }],
    ["refusing focus outright", { throwOnFocus: true }],
  ] as const) {
    test(`an opener that is ${what} is not focused, and is still consumed`, () => {
      const s = slots();
      const trigger = fake("trigger", state);
      drive.open(s, trigger);
      drive.close(s);

      assert.equal(drive.exit(s), false);
      assert.equal(trigger.focusCount, 0);
      assert.equal(s.pending.current, null);
      assert.equal(s.opener.current, null);
    });
  }

  test("repeated open/close cycles keep no stale opener", () => {
    const s = slots();
    const triggers = [fake("t0"), fake("t1"), fake("t2")];
    for (const trigger of triggers) {
      drive.open(s, trigger);
      drive.close(s);
      drive.exit(s);
      assert.equal(s.opener.current, null);
      assert.equal(s.pending.current, null);
    }
    // Each cycle handed focus back to its *own* trigger, exactly once.
    assert.deepEqual(triggers.map((t) => t.focusCount), [1, 1, 1]);
  });
});

/**
 * The case the two slots were nearly right for.
 *
 * Deferring the handback to the off-screen beat is what leaves the drawer
 * reopenable *while the handback is still owed*, and the open effect has to
 * decide what that means. It used to capture `document.activeElement` and then
 * cancel what was owed — two statements that are each defensible and together
 * lose the trigger, because during an interrupted exit the active element is
 * inside the closing drawer. What the reader then sees is nothing at all: the
 * final close hands focus to a control that unmounted with the drawer,
 * `restoreFocus` refuses it for being disconnected, and they are left on
 * `<body>` with no way back to the trigger by keyboard.
 *
 * These drive the hook's own transitions in the orders a reader can produce, and
 * assert the property the fix is for: **the element that opened the drawer from
 * the page is the restoration target until the drawer has fully closed, however
 * many exits are interrupted on the way.**
 */
describe("an exit interrupted by a reopen", () => {
  test("reopening during the exit preserves the original trigger", () => {
    const s = slots();
    const originalTrigger = fake("adp-trigger");
    const drawerControl = fake("season-chip");

    // Opened from the app bar: the trigger is what holds focus.
    drive.open(s, originalTrigger);
    assert.equal(s.opener.current, originalTrigger);

    // Closing begins — owed, unpaid.
    drive.close(s);
    assert.equal(s.opener.current, null);
    assert.equal(s.pending.current, originalTrigger);

    // Pressed again mid-slide. Focus is still inside the closing drawer, so
    // this is what the browser would report; it must not become the opener.
    drive.open(s, drawerControl);

    assert.equal(s.opener.current, originalTrigger, "the page's trigger is taken back");
    assert.equal(s.pending.current, null, "and is no longer owed while the drawer is up");
    assert.equal(drawerControl.focusCount, 0, "the drawer's own control is never a target");
    assert.equal(originalTrigger.focusCount, 0, "and nothing has been handed back yet");

    // The reopened drawer closes for good.
    drive.close(s);
    assert.equal(s.pending.current, originalTrigger);
    assert.equal(originalTrigger.focusCount, 0, "still not while it is on screen");

    assert.equal(drive.exit(s), true);
    assert.equal(originalTrigger.focusCount, 1, "restored exactly once, at the end");
  });

  test("the background is never focused while the exit is interrupted", () => {
    const s = slots();
    const originalTrigger = fake("adp-trigger");
    const drawerControl = fake("filters-key");

    drive.open(s, originalTrigger);
    drive.close(s);
    drive.open(s, drawerControl);

    // The exit timer from the *first* close is torn down by the reopen, but the
    // handback must be inert even if a stale one reached the release: a drawer
    // that is back on screen owes nothing to the page behind it.
    assert.equal(drive.exit(s), false);
    assert.equal(originalTrigger.focusCount, 0, "no flash to the trigger mid-slide");
    assert.equal(drawerControl.focusCount, 0);
    assert.equal(s.opener.current, originalTrigger, "and the trigger is still held");
  });

  test("repeated interruptions do not lose the original trigger", () => {
    const s = slots();
    const originalTrigger = fake("adp-trigger");

    drive.open(s, originalTrigger);
    // Five close/reopen cycles, each interrupted by a control inside the drawer
    // — a reader pressing the key twice in a row, which at 240ms is easy to do.
    for (let i = 0; i < 5; i += 1) {
      drive.close(s);
      drive.open(s, fake(`drawer-control-${i}`));
      assert.equal(s.opener.current, originalTrigger, `cycle ${i} kept the trigger`);
    }

    drive.close(s);
    assert.equal(drive.exit(s), true);
    assert.equal(originalTrigger.focusCount, 1, "restored once, to the original trigger");
  });

  test("a completed close clears the state, so the next open captures afresh", () => {
    const s = slots();
    const first = fake("manager-trigger");

    drive.open(s, first);
    drive.close(s);
    drive.open(s, fake("drawer-control"));
    drive.close(s);
    assert.equal(drive.exit(s), true);

    // Nothing is held from the cycle that finished.
    assert.equal(s.opener.current, null);
    assert.equal(s.pending.current, null);

    // A later opening — another page, another trigger — captures its own.
    const second = fake("trades-trigger");
    drive.open(s, second);
    assert.equal(s.opener.current, second, "the new trigger, not the stale one");

    drive.close(s);
    assert.equal(drive.exit(s), true);
    assert.equal(second.focusCount, 1);
    assert.equal(first.focusCount, 1, "and the first was paid by its own cycle, once");
  });

  test("an unmount mid-interruption restores the original trigger, once", () => {
    const s = slots();
    const originalTrigger = fake("adp-trigger");

    drive.open(s, originalTrigger);
    drive.close(s);
    drive.open(s, fake("drawer-control"));

    // Navigated away while the reopened drawer is up: the `open` effect's
    // cleanup defers, and the mount-lifetime cleanup declared after it releases.
    drive.close(s);
    assert.equal(drive.exit(s), true);
    // The `onScreen` effect can also reach the release on the way down; the slot
    // is already empty, so it cannot pay a second time.
    assert.equal(drive.exit(s), false);
    assert.equal(originalTrigger.focusCount, 1);
  });
});

describe("the page's scroll lock", () => {
  test("it hides overflow and hands back the undo", () => {
    const body = { style: { overflow: "" } };
    const release = lockScroll(body);
    assert.equal(body.style.overflow, "hidden");
    release();
    assert.equal(body.style.overflow, "");
  });

  test("it restores what was there, not a default", () => {
    const body = { style: { overflow: "scroll" } };
    const release = lockScroll(body);
    assert.equal(body.style.overflow, "hidden");
    release();
    assert.equal(body.style.overflow, "scroll");
  });

  test("repeated open/close cycles leave the page exactly as they found it", () => {
    const body = { style: { overflow: "auto" } };
    for (let i = 0; i < 5; i += 1) {
      const release = lockScroll(body);
      assert.equal(body.style.overflow, "hidden");
      release();
      assert.equal(body.style.overflow, "auto");
    }
  });

  test("releasing twice is harmless — an unmount mid-exit runs one cleanup", () => {
    const body = { style: { overflow: "" } };
    const release = lockScroll(body);
    release();
    release();
    assert.equal(body.style.overflow, "");
  });
});

describe("the beat the drawer stays mounted for", () => {
  test("leaving is shorter than arriving", () => {
    // The two literal durations are pinned in `adp-drawer.render.test.ts`,
    // where they are also what the animation strings are built from. What is
    // asserted here is the relationship between them, which nothing else
    // checks: arriving is eased out over a longer beat so the panel settles
    // where it lands, where a dismissed control's job is to get out of the way.
    // The unmount waits out the exit on a **timer** rather than `animationend`,
    // since `prefers-reduced-motion` cancels the animation and no event would
    // ever fire — a drawer closed once would stay mounted forever.
    assert.ok(ADP_DRAWER_EXIT_MS < ADP_DRAWER_ENTER_MS);
    assert.ok(ADP_DRAWER_EXIT_MS > 0);
  });
});
