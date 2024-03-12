import { getTrendColorValue } from "../../Helpers/getTrendColor";
import React, { useState, useEffect, useMemo } from "react";
import { useSelector } from "react-redux";
import { getAdpFormatted } from "../../Helpers/getAdpFormatted";
import HeaderDropdown from "../HeaderDropdown";
import { getTrendColorRank } from "../../Helpers/getTrendColor";
const Roster = React.lazy(() => import("../Roster/Roster"));
const TableMain = React.lazy(() => import("../TableMain"));

const Standings = ({ league, type }) => {
  const { allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);
  const [standingsType, setStandingsType] = useState("Dynasty");
  const [valueType, setValueType] = useState("ADP");
  const [itemActive2, setItemActive2] = useState(league?.userRoster?.roster_id);
  const [expandRoster, setExpandRoster] = useState(false);
  const [filter, setFilter] = useState("All");
  const [pageAvailable, setPageAvailable] = useState(1);

  const active_roster = league.rosters.find((x) => x.roster_id === itemActive2);

  useEffect(() => {
    if (league.settings.type !== 0) {
      setStandingsType("Dynasty");
    } else {
      setStandingsType("Redraft");
    }
  }, [league]);

  const standings_headers = [
    [
      {
        text: "Manager",
        colSpan: 5,
      },
      ...(standingsType === "Dynasty"
        ? [
            {
              text: "Players",
              colSpan: 2,
            },
            {
              text: "Picks",
              colSpan: 2,
            },
            {
              text: "Total",
              colSpan: 2,
            },
          ]
        : [
            { text: "Starters", colSpan: 2 },
            {
              text: "Bench",
              colSpan: 2,
            },
            {
              text: "Total",
              colSpan: 2,
            },
          ]),
    ],
  ];

  const roster_values_dynasty_players = league.rosters.map(
    (roster) => roster.dynasty_starters + roster.dynasty_bench
  );

  const roster_values_dynasty_picks = league.rosters.map(
    (roster) => roster.dynasty_picks
  );

  const roster_values_dynasty_total = league.rosters.map(
    (roster) =>
      roster.dynasty_starters + roster.dynasty_bench + roster.dynasty_picks
  );

  const roster_values_redraft_starters = league.rosters.map(
    (roster) => roster.redraft_starters
  );

  const roster_values_redraft_bench = league.rosters.map(
    (roster) => roster.redraft_bench
  );

  const roster_values_redraft_total = league.rosters.map(
    (roster) => roster.redraft_starters + roster.redraft_bench
  );

  const standings_body = league.rosters.map((roster) => {
    const dynasty_players = roster.dynasty_starters + roster.dynasty_bench;
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
      sort:
        standingsType === "Dynasty"
          ? roster.dynasty_starters +
            roster.dynasty_bench +
            roster.dynasty_picks
          : roster.redraft_starters + roster.redraft_bench,
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
        ...(standingsType === "Dynasty"
          ? [
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      dynasty_players,
                      roster_values_dynasty_players
                    )}
                  >
                    {dynasty_players.toFixed(0)}
                  </span>
                ),
                colSpan: 2,
              },
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      roster.dynasty_picks,
                      roster_values_dynasty_picks
                    )}
                  >
                    {roster.dynasty_picks.toFixed(0)}
                  </span>
                ),
                colSpan: 2,
              },
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      roster.dynasty_starters +
                        roster.dynasty_bench +
                        roster.dynasty_picks,
                      roster_values_dynasty_total
                    )}
                  >
                    {(
                      roster.dynasty_starters +
                      roster.dynasty_bench +
                      roster.dynasty_picks
                    ).toFixed(0)}
                  </span>
                ),
                colSpan: 2,
              },
            ]
          : [
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      roster.redraft_starters,
                      roster_values_redraft_starters
                    )}
                  >
                    {roster.redraft_starters.toFixed(0)}
                  </span>
                ),
                colSpan: 2,
              },
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      roster.redraft_bench,
                      roster_values_redraft_bench
                    )}
                  >
                    {roster.redraft_bench.toFixed(0)}
                  </span>
                ),
                colSpan: 2,
              },
              {
                text: (
                  <span
                    className="stat"
                    style={getTrendColorValue(
                      roster.redraft_starters + roster.redraft_bench,
                      roster_values_redraft_total
                    )}
                  >
                    {(roster.redraft_starters + roster.redraft_bench).toFixed(
                      0
                    )}
                  </span>
                ),
                colSpan: 2,
              },
            ]),
      ],
    };
  });

  const available_headers = [
    [
      {
        text: (
          <HeaderDropdown
            column_text={filter}
            setState={setFilter}
            columnOptions={["All", "QB", "RB", "WR", "TE"]}
          />
        ),
        colSpan: 4,
        className: "half",
      },
      {
        text: <p className="">Available</p>,
        colSpan: 15,
        className: "half",
      },
      {
        text: (
          <HeaderDropdown
            column_text={standingsType}
            setState={setStandingsType}
            columnOptions={["Dynasty", "Redraft"]}
          />
        ),
        colSpan: 9,
        className: "half",
      },
    ],
    [
      {
        text: "Slot",
        colSpan: 4,
        className: "half",
      },
      {
        text: "Player",
        colSpan: 15,
        className: "half",
      },
      {
        text: (
          <HeaderDropdown
            column_text={valueType}
            setState={setValueType}
            columnOptions={["ADP", "Auction %"]}
          />
        ),
        colSpan: 9,
        className: "half",
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
                  Object.keys(adpLm?.[standingsType]).length -
                    adpLm?.[standingsType]?.[player_id]?.adp,
                  league.roster_positions.length * league.rosters.length,
                  Object.keys(adpLm?.[standingsType]).length
                )}
              >
                {(adpLm?.[standingsType]?.[player_id]?.adp &&
                  getAdpFormatted(adpLm?.[standingsType]?.[player_id]?.adp)) ||
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
      <div className="secondary nav">
        <div>
          <HeaderDropdown
            column_text={standingsType}
            columnOptions={["Dynasty", "Redraft"]}
            setState={setStandingsType}
          />
        </div>
        <div>
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
          setStandingsType={(value) => setStandingsType(value)}
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
