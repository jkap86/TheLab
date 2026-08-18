"use client";

import { useMemo } from "react";

import { leaguemateShares } from "../../leaguemates.ts";
import {
  DEFAULT_LEAGUEMATE_COLUMNS,
  LEAGUEMATE_SHARE_METRICS,
  SHARE_COLUMN_PRESETS,
} from "../../share-metrics.ts";
import type { SubjectView } from "../../subject-view.ts";
import { useManagerLeaguemates } from "../../use-manager-leaguemates";
import { usePersistedColumns } from "../../use-persisted-columns";
import { LeaguemateShares } from "./leaguemate-shares";
import { SharesSheet } from "./shares-sheet";

/**
 * The leaguemate-shares browse: everyone the manager shares a league with, over
 * the page those leagues are listed on, each row a way to narrow that page to the
 * ones they are both in.
 *
 * The second door of the pair, and the reason the sheet is a shell — it is
 * {@link SharesSheet} with the member lists where the rosters go and
 * {@link LeaguemateShares} where the player list goes. It exists because typing
 * was the only way to reach a person: the rail's search caps at eight and ranks by
 * name, so the crowd a reader actually plays against — the twenty people in a
 * dozen of their leagues each — was reachable only by already knowing which name
 * to type. Ranked and counted, that list *is* the answer to "who do I play with",
 * which is a thing worth reading before it is a thing worth filtering by.
 *
 * Its columns are the Leaguemates tab's: the two counts and how the manager fares
 * in the leagues they share, off the same persisted `share` selection the players
 * list aims. There is no ADP board here for the same reason that tab's menu holds
 * none — a price is a fact about a player, and a menu offering a column that can
 * never answer is worse than one that is shorter.
 */
export function LeaguemateSharesSheet({
  view,
  open,
  onClose,
}: {
  view: SubjectView;
  open: boolean;
  onClose: () => void;
}) {
  const leagues = view.leagues;
  // Off until the sheet is opened, and the same query key the rail's panel and
  // the Leaguemates tab already name — so a reader who has been to either pays
  // nothing, and a reader who never opens this costs no request.
  const membership = useManagerLeaguemates(
    view.searched,
    view.userId,
    leagues,
    open,
    view.seasonRead,
  );

  const selfId = view.userId;
  const shares = useMemo(
    () =>
      membership.data && selfId
        ? leaguemateShares(
            view.leagueFiltered,
            membership.data.members,
            membership.data.users,
            selfId,
          )
        : null,
    [view.leagueFiltered, membership.data, selfId],
  );

  const { columns, setColumn, setColumns, reset } = usePersistedColumns(
    "share",
    DEFAULT_LEAGUEMATE_COLUMNS,
    LEAGUEMATE_SHARE_METRICS,
  );

  return (
    <SharesSheet
      view={view}
      open={open}
      onClose={onClose}
      kind="leaguemate"
      title="Leaguemate shares"
      subject="Leaguemate"
      loadingLabel="Reading member lists…"
      emptyLabel="No leaguemates in these leagues yet."
      noMatchLabel="Nobody by that name in these leagues."
      rows={shares?.mates ?? null}
      leagueCount={shares?.league_count ?? 0}
      error={membership.error}
      subjectId={(mate) => mate.user_id}
      metrics={LEAGUEMATE_SHARE_METRICS}
      presets={SHARE_COLUMN_PRESETS}
      columns={columns}
      onColumnChange={setColumn}
      onColumns={setColumns}
      onReset={reset}
    >
      {(rows, selection) => (
        <LeaguemateShares
          mates={rows}
          leagueCount={shares?.league_count ?? 0}
          columns={columns}
          isSelected={selection.isSelected}
          onSelect={selection.onSelect}
        />
      )}
    </SharesSheet>
  );
}
