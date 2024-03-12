import TableMain from "../TableMain";
import { useState, useEffect } from "react";
import { useSelector } from "react-redux";
import { getAdpFormatted } from "../../Helpers/getAdpFormatted";
import { getTrendColorRank } from "../../Helpers/getTrendColor";
import HeaderDropdown from "../HeaderDropdown";

const Roster = ({ roster, league, type }) => {
  const [filter, setFilter] = useState("All");
  const [ppgType, setPpgType] = useState("ADP");
  const [standingsType, setStandingsType] = useState("");
  const { state, allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);

  useEffect(() => {
    if (league.settings.type !== 0) {
      setStandingsType("Dynasty");
    } else {
      setStandingsType("Redraft");
    }
  }, [league]);

  const position_abbrev = {
    QB: "QB",
    RB: "RB",
    WR: "WR",
    TE: "TE",
    SUPER_FLEX: "SF",
    FLEX: "WRT",
    WRRB_FLEX: "W R",
    WRRB_WRT: "W R",
    REC_FLEX: "W T",
  };

  const headers = [
    [
      {
        text: (
          <HeaderDropdown
            column_text={filter}
            columnOptions={["All", "QB", "RB", "WR", "TE", "Picks"]}
            setState={setFilter}
          />
        ),
        colSpan: 4,
        className: "half",
      },
      {
        text: <span className="username">{roster.username}</span>,
        colSpan: 15,
        className: "half",
      },
      {
        text: (
          <HeaderDropdown
            column_text={standingsType}
            columnOptions={["Dynasty", "Redraft"]}
            setState={(value) => setStandingsType(value)}
          />
        ),
        colSpan: 9,
        className: "half",
      },
    ],
    [
      {
        text: <span>Slot</span>,
        colSpan: 4,
        className: "half",
      },
      {
        text: <span>Player</span>,
        colSpan: 15,
        className: "half",
      },
      {
        text: (
          <HeaderDropdown
            column_text={ppgType}
            columnOptions={["ADP", "Auction %"]}
            setState={setPpgType}
          />
        ),
        colSpan: 9,
        className: "half",
      },
    ],
  ];

  const getBody = () => {
    return [
      ...[
        ...((filter === "All" && roster.starters) || []),
        ...((filter !== "Picks" && roster.players) || [])
          .filter(
            (player_id) =>
              (filter === "All" && !roster.starters.includes(player_id)) ||
              allplayers[player_id]?.position === filter
          )
          .sort((a, b) => {
            const getPositionValue = (player_id) => {
              const position = allplayers[player_id]?.position;

              switch (position) {
                case "QB":
                  return 1;
                case "RB":
                  return 2;
                case "FB":
                  return 2;
                case "WR":
                  return 3;
                case "TE":
                  return 4;
                default:
                  return 5;
              }
            };

            return (
              getPositionValue(a) - getPositionValue(b) ||
              (adpLm?.["Dynasty"]?.[a]?.adp || 999) -
                (adpLm?.["Dynasty"]?.[b]?.adp || 999)
            );
          }),
      ].map((player_id, index) => {
        return {
          id: player_id,
          list: [
            {
              text:
                filter === "All"
                  ? (league.roster_positions &&
                      position_abbrev[league.roster_positions[index]]) ||
                    (league.roster_positions &&
                      league.roster_positions[index]) ||
                    "BN"
                  : allplayers[player_id]?.position,
              colSpan: 4,
            },
            {
              text: allplayers[player_id]?.full_name || "-",
              colSpan: 15,
              image: {
                src: player_id,
                alt: "player headshot",
                type: "player",
              },
            },
            {
              text: (
                <span
                  className="stat adp"
                  style={getTrendColorRank(
                    roster.starters.length * league.rosters.length -
                      adpLm?.[standingsType]?.[player_id]?.adp,
                    1,
                    roster.starters.length * league.rosters.length
                  )}
                >
                  {(adpLm?.[standingsType]?.[player_id]?.adp &&
                    getAdpFormatted(
                      adpLm?.[standingsType]?.[player_id]?.adp
                    )) ||
                    "-"}
                </span>
              ),
              colSpan: 9,
            },
          ],
        };
      }),
      ...(["All", "Picks"].includes(filter) ? roster.draft_picks : [])
        ?.sort(
          (a, b) =>
            a.season - b.season || a.round - b.round || a.order - b.order
        )
        ?.map((pick) => {
          const adp =
            adpLm["Dynasty"]?.[
              "R" +
                ((pick.round - 1) * 12 +
                  (parseInt(
                    pick.season === parseInt(league.season) && pick.order
                  ) ||
                    Math.min(
                      6 + (parseInt(pick.season) - parseInt(league.season)) * 3,
                      12
                    )))
            ]?.adp;

          const auction_value =
            adpLm["Dynasty_auction"]?.[
              "R" +
                ((pick.round - 1) * 12 +
                  (parseInt(
                    pick.season === parseInt(league.season) && pick.order
                  ) ||
                    Math.min(
                      6 + (parseInt(pick.season) - parseInt(league.season)) * 3,
                      12
                    )))
            ]?.adp;

          return {
            id: `${pick.season}_${pick.round}_${pick.original_user.user_id}`,
            list: [
              {
                text: <span>PICK</span>,
                colSpan: 4,
              },
              {
                text: (
                  <span className="left">
                    {`${pick.season} Round ${pick.round}${
                      parseInt(pick.order) &&
                      pick.season === parseInt(state.league_season)
                        ? `.${pick.order.toLocaleString("en-US", {
                            minimumIntegerDigits: 2,
                          })}`
                        : pick.original_user.user_id === roster?.user_id
                        ? ""
                        : ` (${pick.original_user?.username || "Orphan"})`
                    }`.toString()}
                  </span>
                ),
                colSpan: 15,
                className: "left",
              },
              {
                text: (
                  <span
                    className="stat adp"
                    style={getTrendColorRank(
                      roster.starters.length * league.rosters.length - adp,
                      1,
                      roster.starters.length * league.rosters.length
                    )}
                  >
                    {(adp && getAdpFormatted(adp)) || "-"}
                  </span>
                ),
                colSpan: 9,
              },
            ],
          };
        }),
      ,
    ];
  };

  return <TableMain type={`${type}`} headers={headers} body={getBody()} />;
};

export default Roster;
