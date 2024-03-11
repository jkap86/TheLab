import TableMain from "../TableMain";
import { useState, useMemo } from "react";
import { useSelector } from "react-redux";
import { getAdpFormatted } from "../../Helpers/getAdpFormatted";
import { getTrendColorRank } from "../../Helpers/getTrendColor";

const Roster = ({ roster, league, type, standingsType, setStandingsType }) => {
  const [filter, setFilter] = useState("All");
  const [ppgType, setPpgType] = useState("ADP");
  const { state, allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);

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
          <>
            <span>{filter}</span>
            <select
              className="hidden_behind"
              onChange={(e) => setFilter(e.target.value)}
              value={filter}
            >
              <option>All</option>
              <option>QB</option>
              <option>RB</option>
              <option>WR</option>
              <option>TE</option>
              <option>Picks</option>
            </select>
          </>
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
          <>
            <span>{standingsType}</span>
            <select
              onChange={(e) => setStandingsType(e.target.value)}
              className="hidden_behind"
              value={standingsType}
            >
              <option>Dynasty</option>
              <option>Redraft</option>
            </select>
          </>
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
        text: <span>{ppgType === "ADP" ? "Draft" : "PPG"}</span>,
        colSpan: 5,
        className: "half",
      },
      {
        text: <span>{ppgType === "ADP" ? "Auction" : "#"}</span>,
        colSpan: 4,
        className: "half end",
      },
    ],
  ];

  const getBody = () => {
    if (filter === "All") {
      return [
        ...(roster.starters || []),
        ...(roster.players || [])
          .filter((player_id) => !roster.starters.includes(player_id))
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
                  className="stat"
                  style={getTrendColorRank(
                    roster.starters.length * league.rosters.length -
                      adpLm?.["Dynasty"]?.[player_id]?.adp,
                    1,
                    roster.starters.length * league.rosters.length
                  )}
                >
                  {(adpLm?.["Dynasty"]?.[player_id]?.adp &&
                    getAdpFormatted(adpLm?.["Dynasty"]?.[player_id]?.adp)) ||
                    "-"}
                </span>
              ),
              colSpan: 5,
            },
            {
              text:
                (adpLm?.["Dynasty_auction"]?.[player_id]?.adp?.toFixed(0) ||
                  "0") + "%",
              colSpan: 4,
            },
          ],
        };
      });
    }
  };

  return <TableMain type={`${type} half`} headers={headers} body={getBody()} />;
};

export default Roster;
