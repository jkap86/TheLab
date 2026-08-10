/**
 * Opening and closing a native `<dialog>` without assuming it works.
 *
 * `showModal()` is not a setter. It throws `InvalidStateError` on a dialog that
 * is already open non-modally, it throws `NotSupportedError` on a dialog that
 * is not in the document, and it is simply absent on an engine that has not
 * implemented it. React gives none of that back: the call sits in an effect, so
 * a throw there is an uncaught error inside a commit, which React answers by
 * unmounting the tree to the nearest boundary — on a route with none, that is
 * the whole page. What the reader sees is the app blanking or reloading on the
 * press that opened the sheet, which is indistinguishable from the crash this
 * module was written alongside and is the reason it must not be possible.
 *
 * So every way out is a returned outcome rather than an exception, and the last
 * of them is the `open` attribute — a non-modal dialog, which is the same panel
 * without the top layer, the focus trap or the backdrop. It is strictly worse
 * and it is on screen, which beats a dialog nobody can open.
 *
 * Pure, and typed against the parts of `HTMLDialogElement` it actually touches,
 * so the rules can be driven against fakes — the split `resolveManagerUser` and
 * `internal-auth/policy` already keep between a decision and the DOM (or the
 * `NextResponse`) it is spent on.
 */

/** As much of `HTMLDialogElement` as opening one needs. */
export type DialogLike = {
  open: boolean;
  isConnected?: boolean;
  showModal?: () => void;
  close?: () => void;
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
};

/**
 * What happened.
 *
 * `detached` is not a failure: an effect runs after the commit that scheduled
 * it, and a press that opens a sheet can be followed by a navigation before the
 * browser gets there. There is nothing to open and nothing to report.
 */
export type DialogOpenOutcome =
  /** It was already up — the effect re-ran, nothing to do. */
  | "already-open"
  /** `showModal()` — the top layer, the trap, the backdrop, Escape. */
  | "modal"
  /** The `open` attribute — on screen, without any of that. */
  | "non-modal"
  /** No element, or one no longer in the document. */
  | "detached"
  /** Neither spelling took. The caller has nothing left to try. */
  | "failed";

export function openDialog(dialog: DialogLike | null | undefined): DialogOpenOutcome {
  if (!dialog) return "detached";
  // `isConnected` is `false` only for an element genuinely out of the document;
  // a fake that does not model it is treated as connected rather than as broken.
  if (dialog.isConnected === false) return "detached";
  if (dialog.open) return "already-open";

  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch {
      // Swallowed on purpose: what matters is whether the dialog ended up open,
      // which is asked below whether this threw or returned. An engine that
      // throws `InvalidStateError` here has left the element untouched, so the
      // fallback is the same one an engine with no `showModal` at all takes.
    }
    if (dialog.open) return "modal";
  }

  try {
    dialog.setAttribute?.("open", "");
  } catch {
    // Same reasoning: the state is the answer, not the call.
  }
  return dialog.open ? "non-modal" : "failed";
}

/**
 * Shut it, by whichever spelling opened it.
 *
 * `close()` on a dialog opened through the attribute is legal and fires `close`,
 * which is what the sheet's own `onClose` hears — so the modal and non-modal
 * paths converge here and the caller needs no memory of which it got. Removing
 * the attribute is the last resort for an engine with no `close()` at all, and
 * it deliberately fires nothing: a caller that reached it has already decided
 * this dialog is shut.
 */
export function closeDialog(dialog: DialogLike | null | undefined): void {
  if (!dialog || !dialog.open) return;
  try {
    if (typeof dialog.close === "function") {
      dialog.close();
      if (!dialog.open) return;
    }
  } catch {
    // Fall through to the attribute.
  }
  try {
    dialog.removeAttribute?.("open");
  } catch {
    // Nothing further is available, and a throw here would be the same uncaught
    // effect error this module exists to prevent.
  }
}
