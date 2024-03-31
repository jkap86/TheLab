import { useDispatch, useSelector } from "react-redux";
import TableMain from "../../Common/Components/TableMain";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import { setStateLeaguesCheck } from "../redux/actions";
import { filterLeagues } from "../../Common/Helpers/filterLeagues";
import { getColumnValue } from "../helpers/getColumns";
import {
  getPlayersValue,
  getRosterPicksValue,
} from "../../Common/Helpers/rosterValues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";
import { getSortIcon } from "../../Common/Helpers/getSortIcon";
import { getColumnOptionsLeagues } from "../helpers/columnOptionsLeagues";

const LeaguesCheck = ({ secondaryTable }) => {
  const dispatch = useDispatch();
  const { allplayers, state } = useSelector((state) => state.common);
  const { leagues, type1, type2, adpLm } = useSelector((state) => state.user);
  const {
    column2,
    column3,
    column4,
    column5,
    itemActive,
    page,
    sortBy,
    searched,
  } = useSelector((state) => state.leagues.LeaguesCheck);

  const columnOptions = getColumnOptionsLeagues();

  const headers = [
    [
      {
        text: getSortIcon(1, sortBy, dispatch, setStateLeaguesCheck),
        colSpan: 6,
        className: "sort",
      },
      {
        text: getSortIcon(2, sortBy, dispatch, setStateLeaguesCheck),
        colSpan: 3,
        className: "sort",
      },
      {
        text: getSortIcon(3, sortBy, dispatch, setStateLeaguesCheck),
        colSpan: 3,
        className: "sort",
      },
      {
        text: getSortIcon(4, sortBy, dispatch, setStateLeaguesCheck),
        colSpan: 3,
        className: "sort",
      },
      {
        text: getSortIcon(5, sortBy, dispatch, setStateLeaguesCheck),
        colSpan: 3,
        className: "sort",
      },
    ],
    [
      {
        text: <span>League</span>,
        colSpan: 6,
        rowSpan: 2,
        className: sortBy.column === 1 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column2}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesCheck({ column2: value }))
            }
          />
        ),
        colSpan: 3,
        className: sortBy.column === 2 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesCheck({ column3: value }))
            }
          />
        ),
        colSpan: 3,
        className: sortBy.column === 3 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column4}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesCheck({ column4: value }))
            }
          />
        ),
        colSpan: 3,
        className: sortBy.column === 4 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column5}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesCheck({ column5: value }))
            }
          />
        ),
        colSpan: 3,
        className: sortBy.column === 5 ? "sorted" : "",
      },
    ],
  ];

  const isLoading = !adpLm;

  const body = filterLeagues(leagues, type1, type2)
    .filter((league) => !searched?.id || searched?.id === league.league_id)
    .map((league) => {
      const standings_detail = league.rosters.map((roster) => {
        const dynasty_picks = getRosterPicksValue(
          roster.draft_picks,
          "Dynasty",
          adpLm,
          league.season
        );

        const dynasty_optimal = getOptimalLineupADP({
          roster,
          roster_positions: league.roster_positions,
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
          roster_positions: league.roster_positions,
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
        id: league.league_id,
        sortBy:
          sortBy.column === 1
            ? league.index
            : getColumnValue(
                league,
                [column2, column3, column4, column5][sortBy.column - 2],
                isLoading,
                standings_detail,
                true
              ).text,
        search: {
          text: league.name,
          image: {
            src: league.avatar,
            alt: "league avatar",
            type: "league",
          },
        },
        list: [
          {
            text: league.name,
            colSpan: 6,
            image: {
              src: league.avatar,
              alt: league.name,
              type: "league",
            },
            className: sortBy.column === 1 ? "sorted" : "",
          },

          ...[column2, column3, column4, column5].map((column, index) => {
            const { text, getTrendColor } = getColumnValue(
              league,
              column,
              isLoading,
              standings_detail
            );

            return {
              text: (
                <span className="stat" style={getTrendColor}>
                  {text}
                </span>
              ),
              colSpan: 3,
              className: sortBy.column === index + 2 ? "sorted" : "",
            };
          }),
        ],
        secondary_table: secondaryTable({
          league: {
            ...league,
            rosters: standings_detail,
          },
          type: "secondary",
        }),
      };
    })
    .sort((a, b) =>
      sortBy.asc ? (a.sortBy > b.sortBy ? 1 : -1) : a.sortBy < b.sortBy ? 1 : -1
    );

  return (
    <TableMain
      type={"primary"}
      headers={headers}
      body={body}
      searched={searched}
      setSearched={(value) =>
        dispatch(setStateLeaguesCheck({ searched: value }))
      }
      placeholder={"Leagues"}
      itemActive={itemActive}
      setItemActive={(value) =>
        dispatch(setStateLeaguesCheck({ itemActive: value }))
      }
      page={page}
      setPage={(value) => dispatch(setStateLeaguesCheck({ page: value }))}
    />
  );
};

export default LeaguesCheck;
