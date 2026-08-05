"use client";

import { useMemo } from "react";

import type { AdpBoardType } from "@/shared/manager";

import { type AdpControls, adpBoardRows, shownAdpBoards } from "../../adp-controls";
import type { AdpState } from "../../use-adp";
import { AdpBoardHeader } from "./adp-board-header";
import { AdpBoardRow } from "./adp-board-row";
import {
  AdpBoardEmpty,
  AdpBoardError,
  AdpBoardNoRows,
} from "./adp-board-empty-state";
import { EMPTY_PLAYERS } from "./adp-drawer.constants.ts";
import { soleBoardOf, withBoardToggle } from "./adp-drawer.utils.ts";

/**
 * The list itself — the one part of the drawer that scrolls.
 *
 * It owns the display's own ordering rather than taking rows from above,
 * because the ordering is a fact about what is *drawn*: the fetch's order is
 * fair to both markets and therefore right for neither column alone, so
 * `adpBoardRows` re-sorts for the boards on screen and the list renumbers as it
 * renders.
 */
export function AdpBoard({
  board,
  controls,
  steepness,
  onChange,
}: {
  board: AdpState;
  controls: AdpControls;
  /** The curve being previewed, which is the committed one unless a drag is on. */
  steepness: number;
  onChange: (controls: AdpControls) => void;
}) {
  const players = board.data?.players ?? EMPTY_PLAYERS;
  const rows = useMemo(
    () => adpBoardRows(players, controls.boards),
    [players, controls.boards],
  );

  const { redraft_drafts, dynasty_drafts, player_count } = board.data ?? {
    redraft_drafts: null,
    dynasty_drafts: null,
    player_count: null,
  };
  const shown = shownAdpBoards(controls.boards);
  const both = controls.boards === "both";
  const soleBoard: AdpBoardType = soleBoardOf(controls.boards);
  const soleDrafts = soleBoard === "dynasty" ? dynasty_drafts : redraft_drafts;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      {board.error ? (
        <AdpBoardError message={board.error} />
      ) : players.length === 0 ? (
        <AdpBoardEmpty loading={board.loading} />
      ) : (
        <>
          <AdpBoardHeader
            both={both}
            shown={shown}
            soleBoard={soleBoard}
            soleDrafts={soleDrafts}
            redraftDrafts={redraft_drafts}
            dynastyDrafts={dynasty_drafts}
            teams={controls.teams}
            onToggleBoard={(next) => onChange(withBoardToggle(controls, next))}
          />
          {rows.length === 0 ? (
            <AdpBoardNoRows board={soleBoard} />
          ) : (
            <ul>
              {rows.map((player, index) => (
                <AdpBoardRow
                  key={player.player_id}
                  player={player}
                  rank={index + 1}
                  both={both}
                  soleBoard={soleBoard}
                  soleDrafts={soleDrafts}
                  redraftDrafts={redraft_drafts}
                  dynastyDrafts={dynasty_drafts}
                  teams={controls.teams}
                  steepness={steepness}
                />
              ))}
            </ul>
          )}
          {player_count !== null && player_count > players.length && (
            <p className="px-1 pt-2 text-xs text-foreground/35">
              Showing {rows.length.toLocaleString()} of{" "}
              {player_count.toLocaleString()} players matching these filters.
            </p>
          )}
        </>
      )}
    </div>
  );
}
