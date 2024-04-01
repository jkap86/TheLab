import TableMain from "../../Common/Components/TableMain";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import { setStateLeaguemates } from "../redux/actions";
import { getSortIcon } from "../../Common/Helpers/getSortIcon";
import { useDispatch, useSelector } from "react-redux";
import useFetchLeaguemates from "../hooks/useFetchLeaguemates";
import { filterLeagues } from "../../Common/Helpers/filterLeagues";
import { getTrendColorValue } from "../../Common/Helpers/getTrendColor";
import { getLeaguematesColumns } from "../helpers/getLeaguematesColumns";

const LeaguematesPrimary = ({ secondaryTable }) => {
  const dispatch = useDispatch();
  const { username, type1, type2, leaguemates } = useSelector(
    (state) => state.user
  );
  const {
    column3,
    column4,
    column5,
    column6,
    sortBy,
    searched,
    itemActive,
    page,
  } = useSelector((state) => state.leaguemates.primary);

  useFetchLeaguemates();

  const lm_league_counts = Object.fromEntries(
    (leaguemates || []).map((lm) => {
      return [lm.user_id, filterLeagues(lm.leagues, type1, type2).length];
    })
  );

  const columnOptions = ["Record", "FP", "Lm Record", "Lm FP"];

  const headers = [
    [
      {
        text: getSortIcon(1, sortBy, dispatch, setStateLeaguemates),
        colSpan: 4,
        className: "sort",
      },
      {
        text: getSortIcon(2, sortBy, dispatch, setStateLeaguemates),
        colSpan: 1,
        className: "sort",
      },
      {
        text: getSortIcon(3, sortBy, dispatch, setStateLeaguemates),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(4, sortBy, dispatch, setStateLeaguemates),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(5, sortBy, dispatch, setStateLeaguemates),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(6, sortBy, dispatch, setStateLeaguemates),
        colSpan: 2,
        className: "sort",
      },
    ],
    [
      {
        text: "Leaguemate",
        colSpan: 4,
        className: sortBy.column === 1 ? "sorted" : "",
      },
      {
        text: "#",
        colSpan: 1,
        className: sortBy.column === 2 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemates({ column3: value }))
            }
          />
        ),
        colSpan: 2,
        className: sortBy.column === 3 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column4}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemates({ column4: value }))
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
              dispatch(setStateLeaguemates({ column5: value }))
            }
          />
        ),
        colSpan: 2,
        className: sortBy.column === 5 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column6}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguemates({ column6: value }))
            }
          />
        ),
        colSpan: 2,
        className: sortBy.column === 6 ? "sorted" : "",
      },
    ],
  ];

  const body = (leaguemates || [])
    ?.filter(
      (x) =>
        x.username !== username && (!searched?.id || searched.id === x.user_id)
    )
    ?.map((lm) => {
      const lm_leagues = filterLeagues(lm.leagues, type1, type2);

      const lm_leagues_count = lm_league_counts[lm.user_id];

      return {
        id: lm.user_id,
        search: {
          text: lm.username,
          image: {
            src: lm.avatar,
            alt: "lm avatar",
            type: "user",
          },
        },
        sortBy:
          sortBy.column === 1
            ? lm.username
            : sortBy.column === 2
            ? lm_leagues_count
            : getLeaguematesColumns({
                column: [column3, column4, column5, column6][sortBy.column - 3],
                lm_leagues_count,
                lm_leagues,
              }).sort,
        list: [
          {
            text: lm.username || "Orphan",
            colSpan: 4,
            image: {
              src: lm.avatar,
              alt: lm.username,
              type: "user",
            },
            className: sortBy.column === 1 ? "sorted" : "",
          },
          {
            text: (
              <span
                className="stat"
                style={getTrendColorValue(
                  lm_leagues_count,
                  Object.values(lm_league_counts)
                )}
              >
                {lm_leagues_count?.toString()}
              </span>
            ),
            colSpan: 1,
            className: sortBy.column === 2 ? "sorted" : "",
          },
          ...[column3, column4, column5, column6].map((column, index) => {
            const { text, trendColor } = getLeaguematesColumns({
              column,
              lm_leagues_count,
              lm_leagues,
            });

            return {
              text: (
                <span className="stat" style={trendColor}>
                  {text}
                </span>
              ),
              colSpan: 2,
              className: sortBy.column === index + 3 ? "sorted" : "",
            };
          }),
        ],
        secondary_table: secondaryTable({ leaguemate: lm }),
      };
    })
    ?.sort((a, b) => {
      if (sortBy.asc) {
        return a.sortBy > b.sortBy ? 1 : -1;
      } else {
        return b.sortBy > a.sortBy ? 1 : -1;
      }
    });

  return (
    <TableMain
      type={"primary"}
      headers={headers}
      body={body}
      itemActive={itemActive}
      setItemActive={(item) =>
        dispatch(setStateLeaguemates({ itemActive: item }))
      }
      page={page}
      setPage={(page) => dispatch(setStateLeaguemates({ page: page }))}
      searched={searched}
      setSearched={(searched) =>
        dispatch(setStateLeaguemates({ searched: searched }))
      }
    />
  );
};

export default LeaguematesPrimary;
