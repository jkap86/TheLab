import TableMain from "../../Common/Components/TableMain";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import { useSelector, useDispatch } from "react-redux";
import { setStateLeaguesOwned } from "../redux/actions";
import { filterLeagues } from "../../Common/Helpers/filterLeagues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";
import { getColumnValue } from "../../Leagues/helpers/getColumns";
import {
  getPlayersValue,
  getRosterPicksValue,
} from "../../Common/Helpers/rosterValues";
import { getSortIcon } from "../../Common/Helpers/getSortIcon";
import { useEffect } from "react";

const LeaguesOwned = ({
  secondaryTable,
  leagues_owned,
  leagues_taken,
  leagues_available,
  columnOptions,
}) => {
  const dispatch = useDispatch();
  const { allplayers } = useSelector((state) => state.common);
  const { type1, type2, adpLm } = useSelector((state) => state.user);
  const { column2, column3, column4, column5, sortBy, itemActive } =
    useSelector((state) => state.players.owned);

  useEffect(() => {
    if (leagues_taken && sortBy.column === 3) {
      dispatch(
        setStateLeaguesOwned({
          sortBy: {
            ...sortBy,
            column: 4,
          },
        })
      );
    }
  }, [leagues_taken, sortBy, dispatch]);

  const headers = [
    [
      {
        text: getSortIcon(1, sortBy, dispatch, setStateLeaguesOwned),
        colSpan: 5,
        className: "sort",
      },
      {
        text: getSortIcon(2, sortBy, dispatch, setStateLeaguesOwned),
        colSpan: leagues_taken ? 4 : 2,
        className: "sort",
      },
      !leagues_taken && {
        text: getSortIcon(3, sortBy, dispatch, setStateLeaguesOwned),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(4, sortBy, dispatch, setStateLeaguesOwned),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(5, sortBy, dispatch, setStateLeaguesOwned),
        colSpan: 2,
        className: "sort",
      },
    ],
    [
      {
        text: <span>League</span>,
        colSpan: 5,
        rowSpan: 2,
        className: sortBy.column === 1 ? "sorted" : "",
      },
      {
        text: leagues_taken ? (
          <span>Leaguemate</span>
        ) : (
          <HeaderDropdown
            column_text={column2}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesOwned({ column2: value }))
            }
          />
        ),
        colSpan: leagues_taken ? 4 : 2,
        className: sortBy.column === 2 ? "sorted" : "",
      },
      !leagues_taken && {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesOwned({ column3: value }))
            }
          />
        ),
        colSpan: leagues_taken ? 0 : 2,
        className: sortBy.column === 3 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column4}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesOwned({ column4: value }))
            }
          />
        ),
        colSpan: 2,
        className: sortBy.column === 4 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column5}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesOwned({ column5: value }))
            }
          />
        ),
        colSpan: 2,
        className: sortBy.column === 5 ? "sorted" : "",
      },
    ],
  ];

  const body = filterLeagues(
    leagues_owned || leagues_taken || leagues_available,
    type1,
    type2
  )
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

      const columns = leagues_taken
        ? [column4, column5]
        : [column2, column3, column4, column5];
      return {
        id: league.league_id,
        sortBy:
          sortBy.column === 1
            ? league.index
            : leagues_taken && sortBy.column === 2
            ? league.lmRoster.username || "Orphan"
            : getColumnValue(
                league,
                [column2, column3, column4, column5][sortBy.column - 2],
                !adpLm,
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
            colSpan: 5,
            image: {
              src: league.avatar,
              alt: league.name,
              type: "league",
            },
            className: sortBy.column === 1 ? "sorted" : "",
          },
          leagues_taken && {
            text: league.lmRoster.username || <em>Orphan</em>,
            colSpan: 4,
            image: {
              src: league.lmRoster.avatar,
              alt: "lm avatar",
              type: "user",
            },
            className: sortBy.column === 2 ? "sorted" : "",
          },

          ...columns.map((column, index) => {
            const { text, getTrendColor } = getColumnValue(
              league,
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
              colSpan: 2,
              className:
                sortBy.column === index + 2 + (leagues_taken ? 2 : 0)
                  ? "sorted"
                  : "",
            };
          }),
        ],
        secondary_table: secondaryTable({
          league: {
            ...league,
            rosters: standings_detail,
          },
          type: "tertiary",
        }),
      };
    })
    .sort((a, b) =>
      sortBy.asc ? (a.sortBy > b.sortBy ? 1 : -1) : a.sortBy < b.sortBy ? 1 : -1
    );

  return (
    <TableMain
      type={"secondary"}
      headers={headers}
      body={body}
      itemActive={itemActive}
      setItemActive={(value) =>
        dispatch(setStateLeaguesOwned({ itemActive: value }))
      }
    />
  );
};

export default LeaguesOwned;
