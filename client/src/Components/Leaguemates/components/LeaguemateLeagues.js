import TableMain from "../../Common/Components/TableMain";
import { useSelector, useDispatch } from "react-redux";
import { setStateLeaguemateLeagues } from "../redux/actions";
import Standings from "../../Common/Components/Standings";
import { filterLeagues } from "../../Common/Helpers/filterLeagues";
import { getSortIcon } from "../../Common/Helpers/getSortIcon";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import {
  getRosterPicksValue,
  getPlayersValue,
} from "../../Common/Helpers/rosterValues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";
import { getLeaguematesColumns } from "../helpers/getLeaguematesColumns";

const LeaguemateLeagues = ({ leaguemate }) => {
  const dispatch = useDispatch();
  const { allplayers } = useSelector((state) => state.common);
  const { username, type1, type2, adpLm } = useSelector((state) => state.user);
  const { page, itemActive, column2, column3, column4, column5, sortBy } =
    useSelector((state) => state.leaguemates.leaguemate_leagues);

  const columnOptions = [
    "Picks Rank",
    "Players Rank D",
    "Rank D",
    "Rank R",
    "League ID",
  ];

  const leaguemateLeagues_headers = [
    [
      {
        text: getSortIcon(1, sortBy, dispatch, setStateLeaguemateLeagues),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(2, sortBy, dispatch, setStateLeaguemateLeagues),
        colSpan: 1,
        className: "sort",
      },
      {
        text: getSortIcon(3, sortBy, dispatch, setStateLeaguemateLeagues),
        colSpan: 1,
        className: "sort",
      },
      {
        text: getSortIcon(4, sortBy, dispatch, setStateLeaguemateLeagues),
        colSpan: 1,
        className: "sort",
      },
      {
        text: getSortIcon(5, sortBy, dispatch, setStateLeaguemateLeagues),
        colSpan: 1,
        className: "sort",
      },
    ],
    [
      {
        text: <span>League</span>,
        colSpan: 2,
        rowSpan: 2,
        className: sortBy.column === 1 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column2}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemateLeagues({ column2: value }))
            }
          />
        ),
        colSpan: 1,
        className: sortBy.column === 2 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemateLeagues({ column3: value }))
            }
          />
        ),
        colSpan: 1,
        className: sortBy.column === 3 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column4}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemateLeagues({ column4: value }))
            }
          />
        ),
        colSpan: 1,
        className: sortBy.column === 4 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column5}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemateLeagues({ column5: value }))
            }
          />
        ),
        colSpan: 1,
        className: sortBy.column === 5 ? "sorted" : "",
      },
    ],
  ];

  const leaguemateLeagues_body = filterLeagues(
    leaguemate.leagues,
    type1,
    type2
  ).map((lm_league) => {
    const standings_detail = lm_league.rosters.map((roster) => {
      const dynasty_picks = getRosterPicksValue(
        roster.draft_picks,
        "Dynasty",
        adpLm,
        lm_league.season
      );

      const dynasty_optimal = getOptimalLineupADP({
        roster,
        roster_positions: lm_league.roster_positions,
        adpLm,
        allplayers,
        type: "Dynasty",
      });

      const optimal_dynasty_player_ids = dynasty_optimal.map(
        (slot) => slot.player_id
      );

      const dynasty_starters = getPlayersValue(
        optimal_dynasty_player_ids,
        "Dynasty",
        adpLm
      );

      const dynasty_bench = getPlayersValue(
        roster.players?.filter(
          (player_id) => !optimal_dynasty_player_ids.includes(player_id)
        ),
        "Dynasty",
        adpLm
      );

      const redraft_optimal = getOptimalLineupADP({
        roster,
        roster_positions: lm_league.roster_positions,
        adpLm,
        allplayers,
        type: "Redraft",
      });

      const optimal_redraft_player_ids = redraft_optimal.map(
        (slot) => slot.player_id
      );

      const redraft_starters = getPlayersValue(
        optimal_redraft_player_ids,
        "Redraft",
        adpLm
      );

      const redraft_bench = getPlayersValue(
        roster.players?.filter(
          (player_id) => !optimal_redraft_player_ids.includes(player_id)
        ),
        "Redraft",
        adpLm
      );

      return {
        ...roster,
        dynasty_picks,
        dynasty_starters,
        dynasty_bench,
        dynasty_players: dynasty_starters + dynasty_bench,
        dynasty_total: dynasty_starters + dynasty_bench + dynasty_picks,
        redraft_starters,
        redraft_bench,
        redraft_total: redraft_starters + redraft_bench,
        dynasty_optimal,
        redraft_optimal,
        starters_optimal_dynasty: optimal_dynasty_player_ids,
        starters_optimal_redraft: optimal_redraft_player_ids,
      };
    });

    return {
      id: lm_league.league_id,
      list: [
        {
          text: lm_league.name,
          colSpan: 2,
          className: "left",
          image: {
            src: lm_league.avatar,
            alt: "avatar",
            type: "league",
          },
        },
        ...[column2, column3, column4, column5].map((column, index) => {
          const { text, getTrendColor } = getLeaguematesColumns(
            lm_league,
            column,
            !adpLm,
            standings_detail
          );

          return {
            text: (
              <span className="stat" style={getTrendColor}>
                {text}
              </span>
            ),
            colSpan: 1,
            className: sortBy.column === index + 2 ? "sorted" : "",
          };
        }),
      ],
      secondary_table: (
        <Standings
          league={{
            ...lm_league,
            rosters: standings_detail,
          }}
          type={"tertiary"}
        />
      ),
    };
  });

  return (
    <TableMain
      id={"Players"}
      type={"secondary"}
      headers={leaguemateLeagues_headers}
      body={leaguemateLeagues_body}
      page={page}
      setPage={(page) => dispatch(setStateLeaguemateLeagues({ page: page }))}
      itemActive={itemActive}
      setItemActive={(itemActive) =>
        dispatch(setStateLeaguemateLeagues({ itemActive: itemActive }))
      }
    />
  );
};

export default LeaguemateLeagues;
