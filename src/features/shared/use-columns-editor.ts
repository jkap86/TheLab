"use client";

import { useCallback, useState } from "react";

/**
 * Which heading opened the columns editor, and whether its chunk has ever been
 * needed.
 *
 * Both halves are the same three lines wherever the editor is drawn, and there
 * are three places now — the lists' heading rail ({@link ColumnsBar}) and the
 * league detail panel's two tables, which own one of these each. Two copies of it
 * was the drift a shared piece exists to stop, and the second half is the one
 * that is subtle enough to get wrong twice.
 *
 * **`mounted` latches rather than tracking `openSlot !== null`.** The editor is a
 * `dynamic()` import, and it reports every way out through its own `<dialog>`'s
 * `close` event — so unmounting it the instant the slot clears would be
 * unmounting a component inside its own handler. Latched, it stays mounted after
 * the first press, which also makes the second press instant: the chunk is
 * already in memory.
 *
 * **`openSlot` is the slot the dialog opens *armed on*, not a boolean.** Pressing
 * a heading is a press on the column the reader meant; the editor seeds its armed
 * slot from this and then owns it, so re-arming inside survives.
 */
export function useColumnsEditor(): {
  /** The heading that was pressed, or null while the editor is closed. */
  openSlot: number | null;
  /** Open the editor armed on a slot. */
  open: (slot: number) => void;
  /** What the dialog's own `close` event reports through. */
  close: () => void;
  /** Whether to render the editor at all — see the latch above. */
  mounted: boolean;
} {
  const [openSlot, setOpenSlot] = useState<number | null>(null);
  const close = useCallback(() => setOpenSlot(null), []);

  const [mounted, setMounted] = useState(false);
  if (openSlot !== null && !mounted) setMounted(true);

  return { openSlot, open: setOpenSlot, close, mounted };
}
