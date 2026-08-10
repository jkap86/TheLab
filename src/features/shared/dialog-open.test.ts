import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { closeDialog, openDialog, type DialogLike } from "./dialog-open.ts";

/**
 * Opening a `<dialog>` without letting it take the page down with it.
 *
 * The failure this guards is not cosmetic. `showModal()` throws — on an element
 * already open non-modally, on one detached between the press and the effect,
 * and by absence on an engine that never shipped it — and the call sits inside a
 * React effect, where a throw is an uncaught error in a commit. React answers
 * that by unmounting to the nearest boundary, and on a route with none that is
 * the page. Every one of those is a returned outcome here.
 */

/** A dialog that behaves, with the two spellings a browser actually offers. */
function fake(over: Partial<DialogLike> = {}): DialogLike {
  const dialog: DialogLike = {
    open: false,
    isConnected: true,
    showModal() {
      dialog.open = true;
    },
    close() {
      dialog.open = false;
    },
    setAttribute(name) {
      if (name === "open") dialog.open = true;
    },
    removeAttribute(name) {
      if (name === "open") dialog.open = false;
    },
    ...over,
  };
  return dialog;
}

describe("opening", () => {
  test("the ordinary case is a modal, and nothing else is tried", () => {
    let modals = 0;
    let attributes = 0;
    const dialog = fake({
      showModal() {
        modals += 1;
      },
      setAttribute() {
        attributes += 1;
      },
    });
    // `showModal` here does not flip `open`, so this also pins that the outcome
    // is read off the *state* rather than off the call returning.
    assert.equal(openDialog(dialog), "failed");
    assert.equal(modals, 1);
    assert.equal(attributes, 1);

    assert.equal(openDialog(fake()), "modal");
  });

  test("an already-open dialog is left alone", () => {
    // The effect re-runs on every change of `open`, and on a remount; calling
    // `showModal` on a dialog that is up is itself one of the throws.
    let modals = 0;
    const dialog = fake({
      open: true,
      showModal() {
        modals += 1;
      },
    });
    assert.equal(openDialog(dialog), "already-open");
    assert.equal(modals, 0);
  });

  test("a throw falls through to the non-modal spelling rather than out", () => {
    // `InvalidStateError`, which is what a dialog opened by the attribute and
    // then asked for a modal answers with.
    const dialog = fake({
      showModal() {
        throw new DOMException("already open", "InvalidStateError");
      },
    });
    assert.equal(openDialog(dialog), "non-modal");
    assert.equal(dialog.open, true);
  });

  test("an engine with no showModal still puts the panel on screen", () => {
    const dialog = fake({ showModal: undefined });
    assert.equal(openDialog(dialog), "non-modal");
    assert.equal(dialog.open, true);
  });

  test("nothing to open is not a failure", () => {
    // An effect runs after the commit that scheduled it, so a press can be
    // followed by a navigation before the browser gets here. There is nothing to
    // open and nothing to report.
    assert.equal(openDialog(null), "detached");
    assert.equal(openDialog(undefined), "detached");
    assert.equal(openDialog(fake({ isConnected: false })), "detached");
  });

  test("a dialog that models nothing at all is reported, never thrown from", () => {
    const dialog = fake({ showModal: undefined, setAttribute: undefined });
    assert.equal(openDialog(dialog), "failed");
    // And one whose every path throws.
    const hostile = fake({
      showModal() {
        throw new Error("no");
      },
      setAttribute() {
        throw new Error("no");
      },
    });
    assert.equal(openDialog(hostile), "failed");
  });

  test("closing and reopening works, by either spelling", () => {
    const modal = fake();
    assert.equal(openDialog(modal), "modal");
    closeDialog(modal);
    assert.equal(modal.open, false);
    assert.equal(openDialog(modal), "modal");

    const fallback = fake({ showModal: undefined });
    assert.equal(openDialog(fallback), "non-modal");
    closeDialog(fallback);
    assert.equal(fallback.open, false);
    assert.equal(openDialog(fallback), "non-modal");
  });
});

describe("closing", () => {
  test("a shut dialog is left alone", () => {
    let closes = 0;
    closeDialog(fake({ close: () => void (closes += 1) }));
    assert.equal(closes, 0);
  });

  test("`close()` is preferred, because it is what fires the close event", () => {
    // The sheet hears Escape, the backdrop and its own key through one `close`
    // handler; removing the attribute fires nothing, so it is the last resort
    // and never the first.
    let closes = 0;
    let removals = 0;
    const dialog = fake({
      open: true,
      close() {
        closes += 1;
        dialog.open = false;
      },
      removeAttribute() {
        removals += 1;
      },
    });
    closeDialog(dialog);
    assert.equal(closes, 1);
    assert.equal(removals, 0);
  });

  test("a throwing or missing close() still shuts it", () => {
    const throwing = fake({
      open: true,
      close() {
        throw new Error("no");
      },
    });
    closeDialog(throwing);
    assert.equal(throwing.open, false);

    const missing = fake({ open: true, close: undefined });
    closeDialog(missing);
    assert.equal(missing.open, false);
  });

  test("nothing at all is a no-op rather than a throw", () => {
    closeDialog(null);
    closeDialog(undefined);
    closeDialog(fake({ open: true, close: undefined, removeAttribute: undefined }));
  });
});
