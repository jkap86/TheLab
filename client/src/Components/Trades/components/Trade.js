import React from "react";
import { useSelector } from "react-redux";
import TableMain from "../../Common/Components/TableMain";
import Avatar from "../../Common/Components/Avatar";
import { getAdpFormatted } from "../../Common/Helpers/getAdpFormatted";
import {
  getTrendColorRank,
  getTrendColorValue,
} from "../../Common/Helpers/getTrendColor";

const TradeInfo = ({
  trade,
  roster,
  league_type,
  rid,
  trade_totals,
  trade_total,
}) => {
  const {
    state: stateState,
    allplayers,
    ktc,
  } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);
  const { valueType } = useSelector((state) => state.trades.nav);

  return (
    <table className="trade_info">
      <tbody>
        {Object.keys(trade.adds || {})
          .filter((a) => trade.adds[a] === roster?.user_id)
          .map((player_id) => {
            const adp = adpLm?.[league_type]?.[player_id]?.adp || 999;

            const auction_value =
              adpLm?.[`${league_type}_auction`]?.[player_id]?.adp || 0;

            return (
              <tr>
                <td
                  colSpan={5}
                  className={`${
                    trade.tips?.trade_away &&
                    trade.tips?.trade_away?.find(
                      (p) => p.player_id === player_id
                    )
                      ? "redb left"
                      : "left"
                  }`}
                >
                  <span>+ {allplayers[player_id]?.full_name}</span>
                </td>
                {valueType === "ADP" ? (
                  <td className="value" colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorRank(200 - adp, 1, 200)}
                    >
                      {getAdpFormatted(adp)}
                    </span>
                  </td>
                ) : valueType === "Auction %" ? (
                  <td colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorRank(200 - adp, 1, 200)}
                    >
                      {auction_value.toFixed(1)}%
                    </span>
                  </td>
                ) : (
                  <td className="value" colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorRank(
                        ktc[player_id]?.superflex,
                        1,
                        1000
                      )}
                    >
                      {ktc[player_id]?.superflex}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        {trade.draft_picks
          .filter((p) => p.owner_id === parseInt(rid))
          .sort((a, b) => a.season - b.season || a.round - b.round)
          .map((pick) => {
            const pick_ovr = (pick.round - 1) * 12 + (pick.order || 7);
            const pick_name = "R" + pick_ovr;

            const adp = adpLm?.[league_type]?.[pick_name]?.adp || 999;

            const auction_value =
              adpLm?.[`${league_type}_auction`]?.[pick_name]?.adp || 0;

            const rookie_player_ids = Object.keys(ktc)
              .filter((player_id) => allplayers[player_id]?.years_exp === 0)
              .sort((a, b) => ktc[b].superflex - ktc[a].superflex);

            const pick_value =
              ktc[rookie_player_ids?.[pick_ovr - 1]]?.superflex || 0;

            return (
              <tr>
                <td
                  colSpan={5}
                  className={`${
                    trade.tips?.trade_away &&
                    trade.tips?.trade_away?.find((p) =>
                      pick.season === stateState.league_season && pick.order
                        ? p.player_id ===
                          `${pick.season} ${
                            pick.round
                          }.${pick.order?.toLocaleString("en-US", {
                            minimumIntegerDigits: 2,
                          })}`
                        : `${pick.season} Round ${pick.round}`
                    )
                      ? "redb left"
                      : "left"
                  }`}
                >
                  {
                    <span>{`+ ${pick.season} ${
                      pick.season === stateState.league_season ? "" : "Round "
                    }${pick.round}${
                      pick.order && pick.season === stateState.league_season
                        ? `.${pick.order.toLocaleString("en-US", {
                            minimumIntegerDigits: 2,
                          })}`
                        : ` (${pick.original_user?.username || "Orphan"})`
                    }`}</span>
                  }
                </td>
                {valueType === "ADP" ? (
                  <td className="value" colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorRank(200 - adp, 1, 200)}
                    >
                      {getAdpFormatted(adp)}
                    </span>
                  </td>
                ) : valueType === "Auction %" ? (
                  <td className="value" colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorValue(
                        auction_value,
                        Object.keys(adpLm?.[`${league_type}_auction`]).map(
                          (player_id) =>
                            adpLm?.[`${league_type}_auction`][player_id].adp
                        )
                      )}
                    >
                      {auction_value.toFixed(1)}%
                    </span>
                  </td>
                ) : (
                  <td className="value" colSpan={3}>
                    <span
                      className={"stat value"}
                      style={getTrendColorRank(200 - adp, 1, 200)}
                    >
                      {pick_value}
                    </span>
                  </td>
                )}
              </tr>
            );
          })}
        {/*        <tr>
          <td colSpan={11}></td>
          <td colSpan={8}>
            <span
              className="trade_total"
              style={getTrendColorRank(
                trade_total,
                Math.min(...Object.values(trade_totals)) / 2,
                Object.values(trade_totals).reduce((acc, cur) => acc + cur, 0) *
                  0.5 +
                  Math.min(...Object.values(trade_totals)) / 2
              )}
            >
              {trade_total.toFixed(1)}%
            </span>
          </td>
              </tr>*/}
      </tbody>
    </table>
  );
};

const TradeInfo2 = ({ trade, roster, rid }) => {
  const { state: stateState, allplayers } = useSelector(
    (state) => state.common
  );

  return (
    <table className="trade_info">
      <tbody>
        {Object.keys(trade.drops || {})
          .filter((d) => trade.drops[d] === roster?.user_id)
          .map((player_id) => (
            <tr>
              <td
                className={
                  "left end" +
                  `${
                    trade.tips?.acquire &&
                    trade.tips?.acquire?.find((p) => p.player_id === player_id)
                      ? " greenb"
                      : ""
                  }`
                }
                colSpan={4}
              >
                <span className="end">
                  {`- ${allplayers[player_id]?.full_name}`.toString()}
                </span>
              </td>
            </tr>
          ))}
        {trade.draft_picks
          .filter((p) => p.previous_owner_id === parseInt(rid))
          .sort((a, b) => a.season - b.season || a.round - b.round)
          .map((pick) => (
            <tr>
              <td
                colSpan={4}
                className={
                  "left end " +
                  `${
                    trade.tips?.acquire &&
                    trade.tips?.acquire?.find((p) =>
                      pick.season === stateState.league_season && pick.order
                        ? p.player_id ===
                          `${pick.season} ${
                            pick.round
                          }.${pick.order?.toLocaleString("en-US", {
                            minimumIntegerDigits: 2,
                          })}`
                        : `${pick.season} Round ${pick.round}`
                    )
                      ? "greenb"
                      : ""
                  }`
                }
              >
                <span className="end">
                  {`- ${pick.season} ${
                    pick.order && pick.season === stateState.league_season
                      ? ""
                      : "Round"
                  } ${pick.round}${
                    pick.order && pick.season === stateState.league_season
                      ? `.${pick.order.toLocaleString("en-US", {
                          minimumIntegerDigits: 2,
                        })}`
                      : ` (${pick.original_user?.username || "Orphan"})`
                  }`.toString()}
                </span>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  );
};

const Trade = ({ trade }) => {
  const { allplayers, ktc } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);
  const { valueType } = useSelector((state) => state.trades.nav);

  const league_type =
    trade["league.settings"].type === 2
      ? "Dynasty"
      : trade["league.settings"].type === 0
      ? "Redraft"
      : "All";

  const no_qb = trade["league.roster_positions"].filter(
    (p) => p === "QB"
  ).length;

  const no_sf = trade["league.roster_positions"].filter(
    (p) => p === "SUPER_FLEX"
  ).length;

  const no_te = trade["league.roster_positions"].filter(
    (p) => p === "TE"
  ).length;

  const te_prem = trade["league.scoring_settings"]?.bonus_rec_te || 0;

  const trade_totals = Object.fromEntries(
    Object.keys(trade.rosters).map((rid) => {
      const roster = trade.rosters[rid];

      const adds_value = Object.keys(trade.adds || {})
        .filter((a) => trade.adds[a] === roster?.user_id)
        .reduce(
          (acc, cur) =>
            acc +
            (valueType === "KTC"
              ? ktc[cur]?.superflex || 0
              : adpLm?.[`${league_type}_auction`]?.[cur]?.adp || 0),
          0
        );

      const picks_value = trade.draft_picks
        .filter((p) => p.owner_id === parseInt(rid))
        .reduce((acc, cur) => {
          const pick_ovr = (cur.round - 1) * 12 + (cur.order || 7);

          let pick_value;

          if (valueType === "KTC") {
            const rookie_player_ids = Object.keys(ktc)
              .filter((player_id) => allplayers[player_id]?.years_exp === 0)
              .sort((a, b) => ktc[b].superflex - ktc[a].superflex);

            pick_value = ktc[rookie_player_ids?.[pick_ovr - 1]]?.superflex || 0;
          } else {
            const pick_name = "R" + pick_ovr;

            pick_value =
              adpLm?.[`${league_type}_auction`]?.[pick_name]?.adp || 0;
          }
          return acc + pick_value;
        }, 0);

      return [rid, adds_value + picks_value];
    })
  );

  const trade_total_value = Object.values(trade_totals).reduce(
    (acc, cur) => acc + cur,
    0
  );

  const body = [
    {
      id: "title",
      list: [
        {
          text: (
            <span className="timestamp">
              <div>
                {new Date(parseInt(trade.status_updated)).toLocaleDateString(
                  "en-US"
                )}
              </div>
              <div>
                {new Date(parseInt(trade.status_updated)).toLocaleTimeString(
                  "en-US",
                  {
                    hour: "2-digit",
                    minute: "2-digit",
                  }
                )}
              </div>
            </span>
          ),
          colSpan: 3,
          className: "small wrap",
        },
        {
          text: (
            <span>
              <div>
                {trade["league.settings"].type === 2
                  ? "Dynasty"
                  : trade["league.settings"].type === 1
                  ? "Keeper"
                  : "Redraft"}
              </div>
              <div>
                {trade["league.settings"].best_ball === 1
                  ? "Bestball"
                  : "Lineup"}
              </div>
            </span>
          ),
          colSpan: 3,
          className: "type",
        },
        {
          text: trade["league.name"],
          colSpan: 8,
          image: {
            src: trade?.["league.avatar"],
            alt: "league avatar",
            type: "league",
          },
          className: "trade_league",
        },
        {
          text: (
            <span>
              <div>
                {no_qb.toString()} QB {no_sf.toString()} SF
              </div>
              <div>
                {no_te.toString()} TE{" "}
                {te_prem.toLocaleString("en-US", {
                  maximumFractionDigits: 2,
                })}{" "}
                Prem
              </div>
            </span>
          ),
          colSpan: 4,
          className: "type",
        },
      ],
    },
    ...Object.keys(trade.rosters).map((rid, index) => {
      const roster = trade.rosters[rid];

      const trade_total = trade_totals[rid];

      return {
        id: trade.transaction_id,
        list: [
          {
            text: (
              <>
                {roster?.username || "Orphan"}
                <span
                  className="trade_total"
                  style={getTrendColorRank(
                    trade_total,
                    trade_total_value * 0.25,
                    trade_total_value * 0.75
                  )}
                >
                  {valueType === "KTC"
                    ? trade_total.toLocaleString("en-US")
                    : trade_total.toFixed(1) + "%"}
                </span>
              </>
            ),
            image: {
              src: roster?.avatar,
              alt: "avatar",
              type: "user",
            },
            colSpan: 5,
            className: "left trade_manager",
          },
          {
            text: (
              <TradeInfo
                trade={trade}
                roster={roster}
                league_type={league_type}
                rid={rid}
                trade_totals={trade_totals}
                trade_total={trade_total}
              />
            ),
            colSpan: 8,
            rowSpan: 2,
            className: "small",
          },
          {
            text: <TradeInfo2 trade={trade} roster={roster} rid={rid} />,
            colSpan: 5,
            rowSpan: 2,
            className: "small",
          },
        ],
      };
    }),
  ];
  return <TableMain type={"trade_summary"} headers={[]} body={body} />;
};

export default Trade;
