import { getTrendColorValue } from "../../Helpers/getTrendColor";
import React, { useState, useEffect, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import { getAdpFormatted } from "../../Helpers/getAdpFormatted";
import HeaderDropdown from "../HeaderDropdown";
import { getTrendColorRank } from "../../Helpers/getTrendColor";
import { setStateStandings } from "../../Redux/actions";
const Roster = React.lazy(() => import("../Roster/Roster"));
const TableMain = React.lazy(() => import("../TableMain"));

const Standings = ({ league, type }) => {
  const dispatch = useDispatch();
  const { allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);
  const { column2, column3, standingsType, valueType } = useSelector(
    (state) => state.standings
  );
  const [itemActive2, setItemActive2] = useState(league?.userRoster?.roster_id);
  const [expandRoster, setExpandRoster] = useState(false);
  const [filter, setFilter] = useState("All");
  const [pageAvailable, setPageAvailable] = useState(1);

  const active_roster = league.rosters.find((x) => x.roster_id === itemActive2);

  useEffect(() => {
    if (league.settings.type === 0) {
      dispatch(setStateStandings({ standingsType: "Redraft" }));
    }
  }, [league]);

  const handleColumnChange = (value, colIndex) => {
    const columns = {
      2: column2,
      3: column3,
    };

    Object.keys(columns)
      .filter((key) => key !== colIndex)
      .map((key) => {
        if (columns[key] === value) {
          dispatch(
            setStateStandings({
              [`column${key}`]: columns[colIndex],
            })
          );
        }
      });

    dispatch(setStateStandings({ [`column${colIndex}`]: value }));
  };

  const columnOptions = [
    "Starters",
    "Bench",
    ...(standingsType === "Dynasty" ? ["Players"] : ""),
    "Total",
    ...(standingsType === "Dynasty" ? ["Picks"] : ""),
  ];
  const standings_headers = [
    [
      {
        text: "Manager",
        colSpan: 5,
      },

      {
        text: (
          <HeaderDropdown
            column_text={column2}
            columnOptions={columnOptions}
            setState={(value) => handleColumnChange(value, 2)}
          />
        ),
        colSpan: 3,
      },
      {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) => handleColumnChange(value, 3)}
          />
        ),
        colSpan: 3,
      },
    ],
  ];

  const adp_key = `${standingsType}${
    valueType === "Auction %" ? "_auction" : ""
  }`;

  const standings_body = league.rosters.map((roster) => {
    const key1 = `${standingsType.toLowerCase()}_${column2.toLowerCase()}`;
    const stat1 = roster?.[key1];

    const key2 = `${standingsType.toLowerCase()}_${column3.toLowerCase()}`;
    const stat2 = roster?.[key2];

    return {
      id: roster.roster_id,
      search: {
        text: roster.username,
        image: {
          src: roster.avatar,
          alt: "user avatar",
          type: "user",
        },
      },
      sort: stat2,
      list: [
        {
          text: roster.username || <em>Orphan</em>,
          image: {
            src: roster.avatar,
            alt: "user avatar",
            type: "user",
          },
          colSpan: 5,
        },
        {
          text: (
            <span
              className="stat"
              style={getTrendColorValue(
                stat1,
                league.rosters.map((r) => r?.[key1])
              )}
            >
              {stat1?.toFixed(0)}
            </span>
          ),
          colSpan: 3,
        },
        {
          text: (
            <span
              className="stat"
              style={getTrendColorValue(
                stat2,
                league.rosters.map((r) => r?.[key2])
              )}
            >
              {stat2?.toFixed(0)}
            </span>
          ),
          colSpan: 3,
          className: "sorted",
        },
      ],
    };
  });

  const available_headers = [
    [
      {
        text: "Slot",
        colSpan: 4,
      },
      {
        text: "Player",
        colSpan: 15,
      },
      {
        text: (
          <HeaderDropdown
            column_text={valueType}
            setState={(value) =>
              dispatch(setStateStandings({ valueType: value }))
            }
            columnOptions={["ADP", "Auction %"]}
          />
        ),
        colSpan: 9,
      },
    ],
  ];

  const available_body = Object.keys(allplayers)
    .filter(
      (player_id) =>
        !league.rosters?.find((roster) =>
          roster.players?.includes(player_id)
        ) &&
        (league.settings.status === "in_season" ||
          allplayers[player_id]?.years_exp > 0) &&
        ((filter === "All" &&
          league.roster_positions.includes(allplayers[player_id]?.position)) ||
          filter === allplayers[player_id]?.position)
    )
    .sort(
      (a, b) =>
        (adpLm?.[standingsType]?.[a]?.adp || 999) -
        (adpLm?.[standingsType]?.[b]?.adp || 999)
    )
    .map((player_id) => {
      return {
        id: player_id,
        list: [
          {
            text: allplayers[player_id]?.position,
            colSpan: 4,
          },

          {
            text: allplayers[player_id]?.full_name || "-",
            colSpan: 15,
            className: "left",
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
                  Object.keys(adpLm?.[adp_key]).length -
                    adpLm?.[adp_key]?.[player_id]?.adp,
                  league.roster_positions.length * league.rosters.length,
                  Object.keys(adpLm?.[adp_key]).length
                )}
              >
                {(adpLm?.[adp_key]?.[player_id]?.adp &&
                  (valueType === "ADP"
                    ? getAdpFormatted(adpLm?.[adp_key]?.[player_id]?.adp)
                    : adpLm?.[adp_key]?.[player_id]?.adp?.toFixed(0))) ||
                  "-"}
              </span>
            ),
            colSpan: 9,
          },
        ],
      };
    });

  return (
    <>
      <div className={type + " nav"}>
        <div>
          <div>
            <HeaderDropdown
              column_text={standingsType}
              columnOptions={["Dynasty", "Redraft"]}
              setState={(value) =>
                dispatch(setStateStandings({ standingsType: value }))
              }
            />
          </div>
        </div>
        <div>
          <div>
            <HeaderDropdown
              column_text={filter}
              columnOptions={["All", "QB", "RB", "WR", "TE", "Picks"]}
              setState={setFilter}
            />
          </div>
          <span className="username">
            {active_roster ? active_roster.username : "Available"}
          </span>
          {expandRoster ? (
            <i
              className="fa-solid fa-compress click"
              onClick={() => setExpandRoster(false)}
            ></i>
          ) : (
            <i
              className="fa-solid fa-expand click"
              onClick={() => setExpandRoster(true)}
            ></i>
          )}
        </div>
      </div>
      {expandRoster ? (
        ""
      ) : (
        <TableMain
          type={`${type} half`}
          headers={standings_headers}
          body={standings_body}
          itemActive={itemActive2}
          setItemActive={setItemActive2}
        />
      )}
      {active_roster ? (
        <Roster
          type={type + (expandRoster ? "" : " half")}
          roster={{
            ...active_roster,
            starters:
              standingsType === "Dynasty"
                ? active_roster.starters_optimal_dynasty
                : active_roster.starters_optimal_redraft,
          }}
          league={league}
          standingsType={standingsType}
          filter={filter}
          valueType={valueType}
          setValueType={(value) =>
            dispatch(setStateStandings({ valueType: value }))
          }
        />
      ) : (
        <TableMain
          type={type + " half"}
          headers={available_headers}
          body={available_body}
          page={pageAvailable}
          setPage={setPageAvailable}
        />
      )}
    </>
  );
};

export default Standings;
