import React from "react";
import { useSelector } from "react-redux";
import TableMain from "../../Common/Components/TableMain";
import Avatar from "../../Common/Components/Avatar";
import { getAdpFormatted } from "../../Common/Helpers/getAdpFormatted";
import { getTrendColorRank } from "../../Common/Helpers/getTrendColor";

const Trade = ({ trade }) => {
  const { state: stateState, allplayers } = useSelector(
    (state) => state.common
  );
  const { adpLm } = useSelector((state) => state.user);

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

  return (
    <TableMain
      type={"trade_summary"}
      headers={[]}
      body={[
        {
          id: "title",
          list: [
            {
              text: (
                <div className="timestamp">
                  <div>
                    {new Date(
                      parseInt(trade.status_updated)
                    ).toLocaleDateString("en-US")}
                  </div>
                  <div>
                    {new Date(
                      parseInt(trade.status_updated)
                    ).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              ),
              colSpan: 3,
              className: "small wrap",
            },
            {
              text: (
                <>
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
                </>
              ),
              colSpan: 2,
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
              className: "left",
            },
            {
              text: (
                <>
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
                </>
              ),
              colSpan: 3,
              className: "type",
            },
          ],
        },
        ...Object.keys(trade.rosters).map((rid) => {
          const roster = trade.rosters[rid];

          return {
            id: trade.transaction_id,
            list: [
              {
                text: roster?.username || "Orphan",
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
                  <table className="trade_info">
                    <tbody>
                      {Object.keys(trade.adds || {})
                        .filter((a) => trade.adds[a] === roster?.user_id)
                        .map((player_id) => {
                          const adp =
                            adpLm?.[league_type]?.[player_id]?.adp || 999;

                          const auction_value =
                            adpLm?.[`${league_type}_auction`]?.[player_id]
                              ?.adp || 0;

                          return (
                            <tr>
                              <td
                                colSpan={11}
                                className={`${
                                  trade.tips?.trade_away &&
                                  trade.tips?.trade_away?.find(
                                    (p) => p.player_id === player_id
                                  )
                                    ? "redb left"
                                    : "left"
                                }`}
                              >
                                <span>
                                  + {allplayers[player_id]?.full_name}
                                </span>
                              </td>
                              <td className="value" colSpan={4}>
                                <span
                                  className={"stat value"}
                                  style={getTrendColorRank(200 - adp, 1, 200)}
                                >
                                  {getAdpFormatted(adp)}
                                </span>
                              </td>
                              <td colSpan={4}>
                                <span
                                  className={"stat value"}
                                  style={getTrendColorRank(200 - adp, 1, 200)}
                                >
                                  {auction_value.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      {trade.draft_picks
                        .filter((p) => p.owner_id === parseInt(rid))
                        .sort(
                          (a, b) => a.season - b.season || a.round - b.round
                        )
                        .map((pick) => {
                          const pick_name =
                            "R" + ((pick.round - 1) * 12 + (pick.order || 7));

                          const adp =
                            adpLm?.[league_type]?.[pick_name]?.adp || 999;

                          const auction_value =
                            adpLm?.[`${league_type}_auction`]?.[pick_name]
                              ?.adp || 0;

                          return (
                            <tr>
                              <td
                                colSpan={11}
                                className={`${
                                  trade.tips?.trade_away &&
                                  trade.tips?.trade_away?.find((p) =>
                                    pick.season === stateState.league_season &&
                                    pick.order
                                      ? p.player_id ===
                                        `${pick.season} ${
                                          pick.round
                                        }.${pick.order?.toLocaleString(
                                          "en-US",
                                          {
                                            minimumIntegerDigits: 2,
                                          }
                                        )}`
                                      : `${pick.season} Round ${pick.round}`
                                  )
                                    ? "redb left"
                                    : "left"
                                }`}
                              >
                                {
                                  <span>{`+ ${pick.season} ${
                                    pick.season === stateState.league_season
                                      ? ""
                                      : "Round "
                                  }${pick.round}${
                                    pick.order &&
                                    pick.season === stateState.league_season
                                      ? `.${pick.order.toLocaleString("en-US", {
                                          minimumIntegerDigits: 2,
                                        })}`
                                      : ` (${
                                          pick.original_user?.username ||
                                          "Orphan"
                                        })`
                                  }`}</span>
                                }
                              </td>
                              <td className="value" colSpan={4}>
                                <span
                                  className={"stat value"}
                                  style={getTrendColorRank(200 - adp, 1, 200)}
                                >
                                  {getAdpFormatted(adp)}
                                </span>
                              </td>
                              <td colSpan={4} className="relative">
                                <span
                                  className={"stat value"}
                                  style={getTrendColorRank(200 - adp, 1, 200)}
                                >
                                  {auction_value?.toFixed(1)}%
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                ),
                colSpan: 7,
                rowSpan: 2,
                className: "small",
              },
              {
                text: (
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
                                  trade.tips?.acquire?.find(
                                    (p) => p.player_id === player_id
                                  )
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
                        .sort(
                          (a, b) => a.season - b.season || a.round - b.round
                        )
                        .map((pick) => (
                          <tr>
                            <td
                              colSpan={4}
                              className={
                                "left end " +
                                `${
                                  trade.tips?.acquire &&
                                  trade.tips?.acquire?.find((p) =>
                                    pick.season === stateState.league_season &&
                                    pick.order
                                      ? p.player_id ===
                                        `${pick.season} ${
                                          pick.round
                                        }.${pick.order?.toLocaleString(
                                          "en-US",
                                          {
                                            minimumIntegerDigits: 2,
                                          }
                                        )}`
                                      : `${pick.season} Round ${pick.round}`
                                  )
                                    ? "greenb"
                                    : ""
                                }`
                              }
                            >
                              <span className="end">
                                {`- ${pick.season} ${
                                  pick.order &&
                                  pick.season === stateState.league_season
                                    ? ""
                                    : "Round"
                                } ${pick.round}${
                                  pick.order &&
                                  pick.season === stateState.league_season
                                    ? `.${pick.order.toLocaleString("en-US", {
                                        minimumIntegerDigits: 2,
                                      })}`
                                    : ` (${
                                        pick.original_user?.username || "Orphan"
                                      })`
                                }`.toString()}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ),
                colSpan: 4,
                rowSpan: 2,
                className: "small",
              },
            ],
          };
        }),
      ]}
    />
  );
};

export default Trade;
