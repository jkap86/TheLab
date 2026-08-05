import type { AdpBoardType } from "@/shared/manager";

/** The shared shell for everything the board says instead of rows. */
function Notice({ children }: { children: string }) {
  return (
    <p className="px-1 py-6 text-center text-sm text-foreground/45">{children}</p>
  );
}

/**
 * The read failed. Amber rather than the plain notice below, because this is the
 * one of the three that is not an answer about the board.
 */
export function AdpBoardError({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
      ADP unavailable — {message}
    </p>
  );
}

/** Nothing came back: still coming, or no crawled draft matches the filters. */
export function AdpBoardEmpty({ loading }: { loading: boolean }) {
  return (
    <Notice>
      {loading ? "Loading the board…" : "No crawled drafts match these filters."}
    </Notice>
  );
}

/**
 * The filters matched drafts, just none on the one board being shown — a
 * different answer from an empty crawl, and the board keys above are the way out
 * of it.
 */
export function AdpBoardNoRows({ board }: { board: AdpBoardType }) {
  return <Notice>{`Nothing on the ${board} board for these filters.`}</Notice>;
}
