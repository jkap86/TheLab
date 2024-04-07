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
import { getColumnOptionsLeagues } from "../../Leagues/helpers/columnOptionsLeagues";
import { getColumnValue } from "../../Leagues/helpers/getColumns";
import { getLeagueRankings } from "../../Leagues/helpers/getLeagueRankings";

const LeaguemateLeagues = ({ leaguemate }) => {
  const dispatch = useDispatch();
  const { allplayers, ktc, state } = useSelector((state) => state.common);
  const { username, type1, type2, adpLm } = useSelector((state) => state.user);
  const { page, itemActive, column2, column3, column4, column5, sortBy } =
    useSelector((state) => state.leaguemates.leaguemate_leagues);

  const columnOptions = getColumnOptionsLeagues(true);

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

  const leaguemateLeagues_body = filterLeagues(leaguemate.leagues, type1, type2)
    .map((lm_league) => {
      const standings_detail = getLeagueRankings({
        league: lm_league,
        adpLm,
        allplayers,
        ktc,
        state,
      });

      return {
        id: lm_league.league_id,
        sortBy: getColumnValue(
          lm_league,
          [column2, column3, column4, column5][sortBy.column - 2],
          !adpLm,
          standings_detail
        ).text,
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
            const { text, getTrendColor } = getColumnValue(
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
    })
    .sort((a, b) =>
      sortBy.asc ? (a.sortBy > b.sortBy ? 1 : -1) : a.sortBy < b.sortBy ? 1 : -1
    );

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
