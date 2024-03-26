import TableMain from "../TableMain";
import { useSelector } from "react-redux";
import { getAdpFormatted } from "../../Helpers/getAdpFormatted";
import {
  getTrendColorRank,
  getTrendColorValue,
} from "../../Helpers/getTrendColor";
import HeaderDropdown from "../HeaderDropdown";
import {
  position_abbrev,
  position_map,
} from "../../Helpers/getOptimalLineupADP";

const Roster = ({
  roster,
  league,
  type,
  standingsType,
  filter,
  valueType,
  setValueType,
}) => {
  const { state, allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);

  const roster_positions = league.roster_positions.filter((p) =>
    Object.keys(position_map).includes(p)
  );

  const roster_players =
    roster.players?.filter((player_id) => allplayers[player_id]) || [];

  const headers = [
    [
      {
        text: <span>Slot</span>,
        colSpan: 4,
      },
      {
        text: <span>Player</span>,
        colSpan: 15,
      },
      {
        text: (
          <HeaderDropdown
            column_text={valueType}
            columnOptions={["D ADP", "D Auction %", "R ADP", "R Auction %"]}
            setState={setValueType}
          />
        ),
        colSpan: 9,
      },
    ],
  ];

  const adp_key = `${standingsType}${
    valueType?.includes("Auction") ? "_auction" : ""
  }`;

  const getBody = () => {
    return [
      ...[
        ...((filter === "All" && roster?.starters) || []),
        ...((filter !== "Picks" && roster_players) || [])
          .filter(
            (player_id) =>
              (filter === "All" && !roster.starters?.includes(player_id)) ||
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
                  ? (roster_positions &&
                      position_abbrev[roster_positions[index]]) ||
                    (roster_positions && roster_positions[index]) ||
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
                  style={
                    valueType?.includes("ADP")
                      ? getTrendColorRank(
                          roster.starters?.length * league.settings?.num_teams -
                            adpLm?.[adp_key]?.[player_id]?.adp,
                          1,
                          roster.starters?.length * league.settings?.num_teams
                        )
                      : getTrendColorValue(
                          adpLm?.[adp_key]?.[player_id]?.adp,
                          Object.keys(adpLm?.[adp_key] || {}).map(
                            (player_id) =>
                              adpLm?.[adp_key]?.[player_id]?.adp || 0
                          )
                        )
                  }
                >
                  {(adpLm?.[adp_key]?.[player_id]?.adp &&
                    (valueType.includes("ADP")
                      ? getAdpFormatted(adpLm?.[adp_key]?.[player_id]?.adp)
                      : adpLm?.[adp_key]?.[player_id]?.adp?.toFixed(0))) ||
                    "-"}
                </span>
              ),
              colSpan: 9,
            },
          ],
        };
      }),
      ...(["All", "Picks"].includes(filter) ? roster?.draft_picks || [] : [])
        ?.sort(
          (a, b) =>
            a.season - b.season || a.round - b.round || a.order - b.order
        )
        ?.map((pick) => {
          const value =
            adpLm[adp_key]?.[
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
                    style={
                      valueType.includes("ADP")
                        ? getTrendColorRank(
                            roster.starters?.length *
                              league.settings.num_teams -
                              value,
                            1,
                            roster.starters?.length * league.settings.num_teams
                          )
                        : getTrendColorValue(
                            value,
                            Object.keys(adpLm?.[adp_key] || {}).map(
                              (player_id) =>
                                adpLm?.[adp_key]?.[player_id]?.adp || 0
                            )
                          )
                    }
                  >
                    {(value &&
                      (valueType.includes("ADP")
                        ? getAdpFormatted(value)
                        : value?.toFixed(0))) ||
                      "-"}
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
