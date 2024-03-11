import { getTrendColorValue } from "../../Helpers/getTrendColor";
import Roster from "../Roster/Roster";
import TableMain from "../TableMain";
import { useState } from "react";

const Standings = ({ league, type }) => {
  const [standingsType, setStandingsType] = useState("Dynasty");

  const standings_headers = [
    [
      {
        text: (
          <>
            <span>{standingsType}</span>
            <select
              value={standingsType}
              onChange={(e) => setStandingsType(e.target.value)}
              className="hidden_behind"
            >
              <option>Dynasty</option>
              <option>Redraft</option>
            </select>
          </>
        ),
        colSpan: 11,
        className: "half",
      },
    ],
    [
      {
        text: "Manager",
        colSpan: 5,
        className: "half",
      },
      ...(standingsType === "Dynasty"
        ? [
            {
              text: "Players",
              colSpan: 2,
              className: "half",
            },
            {
              text: "Picks",
              colSpan: 2,
              className: "half",
            },
            {
              text: "Total",
              colSpan: 2,
              className: "half",
            },
          ]
        : [
            { text: "Starters", colSpan: 2, className: "half" },
            {
              text: "Bench",
              colSpan: 2,
              className: "half",
            },
            {
              text: "Total",
              colSpan: 2,
              className: "half",
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
        roster.dynasty_starters + roster.dynasty_bench + roster.dynasty_picks,
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
                    {dynasty_players}
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
                    {roster.dynasty_picks}
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
                    {roster.dynasty_starters +
                      roster.dynasty_bench +
                      roster.dynasty_picks}
                  </span>
                ),
                colSpan: 2,
              },
            ]
          : [
              {
                text: roster.redraft_starters + roster.redraft_bench,
                colSpan: 2,
              },
            ]),
      ],
    };
  });
  return (
    <>
      <TableMain
        type={`${type} half`}
        headers={standings_headers}
        body={standings_body}
      />
      <Roster
        roster={league.userRoster}
        league={league}
        standingsType={standingsType}
        setStandingsType={(value) => setStandingsType(value)}
      />
    </>
  );
};

export default Standings;
