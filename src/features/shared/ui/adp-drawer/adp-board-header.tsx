import type { AdpBoardType } from "@/shared/manager";

import type { LeagueFilters } from "../../league-filters";
import {
  BOARD_COLUMNS_BOTH,
  BOARD_COLUMNS_ONE,
  BOARD_NAMES,
} from "./adp-drawer.constants.ts";
import { boardTitle, takenTitle, valueTitle } from "./adp-drawer.utils.ts";
import { KeyChip } from "./key-chip";

/**
 * The board's sticky head: which markets are drawn, and what the columns under
 * them are.
 *
 * Sticky, because the board is the one part of the drawer that scrolls and a
 * column of bare numbers three hundred rows down says nothing. It paints the
 * panel's own ground rather than a translucent one — the rows have to pass
 * *behind* it, not through it. The board keys ride in it rather than in the
 * pinned block above: they choose what the *list* shows, so they sit with the
 * columns they toggle — and each carries its own board's draft count, which is
 * the population a reader needs to weigh a column at all.
 */
export function AdpBoardHeader({
  both,
  shown,
  soleBoard,
  soleDrafts,
  redraftDrafts,
  dynastyDrafts,
  rules,
  refreshing = false,
  onToggleBoard,
}: {
  both: boolean;
  shown: Record<AdpBoardType, boolean>;
  soleBoard: AdpBoardType;
  soleDrafts: number | null;
  redraftDrafts: number | null;
  dynastyDrafts: number | null;
  /** The board's league rules — the value headings' premise reads its size. */
  rules: LeagueFilters;
  /**
   * The rows under this head belong to a previous filter set still on screen
   * while the new board loads. Said here, in the one part of the list that
   * never scrolls away and is always at the top the filter press just reset
   * the scroll to — the dimmed rows say something is off, this says what.
   */
  refreshing?: boolean;
  onToggleBoard: (board: AdpBoardType) => void;
}) {
  return (
    <div className="sticky top-0 z-10 -mx-1 mb-1.5 bg-[rgb(12,23,33)] pt-0.5">
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <span className="text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-foreground/40">
          Boards
        </span>
        <BoardKey
          board="redraft"
          on={shown.redraft}
          drafts={redraftDrafts}
          onToggle={onToggleBoard}
        />
        <BoardKey
          board="dynasty"
          on={shown.dynasty}
          drafts={dynastyDrafts}
          onToggle={onToggleBoard}
        />
        {refreshing && (
          // `role="status"` announces the refresh politely; the pulse is
          // decoration and steps aside under reduced motion, where the words
          // still carry the state.
          <span
            role="status"
            className="ml-auto text-[0.55rem] font-semibold uppercase tracking-[0.14em] text-active/70 motion-safe:animate-pulse"
          >
            Updating…
          </span>
        )}
      </div>
      {both ? (
        <div className={`grid ${BOARD_COLUMNS_BOTH} items-center gap-2 px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35`}>
          <span className="text-right">#</span>
          <span>Player</span>
          <span />
          <span className="text-right" title={boardTitle("redraft", redraftDrafts)}>
            ADP R
          </span>
          <span className="text-right" title={boardTitle("dynasty", dynastyDrafts)}>
            ADP D
          </span>
          <span className="hidden text-right @md:block" title={valueTitle(rules)}>
            Val R
          </span>
          <span className="hidden text-right @md:block" title={valueTitle(rules)}>
            Val D
          </span>
        </div>
      ) : (
        <div className={`grid ${BOARD_COLUMNS_ONE} items-center gap-2 px-2 pb-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-foreground/35`}>
          <span className="text-right">#</span>
          <span>Player</span>
          <span />
          <span className="text-right" title={boardTitle(soleBoard, soleDrafts)}>
            ADP
          </span>
          {/* "Taken" is a share, and the header is the only place to say of
              what — a column reading 46% next to an ADP of 3.2 is otherwise
              a number nobody can name. */}
          <span className="text-right" title={takenTitle(soleBoard)}>
            Taken
          </span>
          <span className="text-right" title={valueTitle(rules)}>
            Value
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * One board's key: whether that market's columns are drawn, with its own draft
 * count on the face — different for the two boards by construction. Toggling the
 * only lit board off is a no-op (`toggleAdpBoard`), so the list can never go
 * blank.
 */
function BoardKey({
  board,
  on,
  drafts,
  onToggle,
}: {
  board: AdpBoardType;
  on: boolean;
  drafts: number | null;
  onToggle: (board: AdpBoardType) => void;
}) {
  return (
    <KeyChip small on={on} onClick={() => onToggle(board)}>
      {BOARD_NAMES[board]}
      {drafts !== null && (
        <span className="ml-1 text-[0.55rem] tabular-nums opacity-70">
          {drafts.toLocaleString()}
        </span>
      )}
    </KeyChip>
  );
}
