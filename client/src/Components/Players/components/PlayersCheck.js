import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import TableMain from "../../Common/Components/TableMain";
import useFetchPlayerShares from "../hooks/useFetchPlayerShares";
import headshot from "../../../Images/headshot.png";
import { useSelector, useDispatch } from "react-redux";
import { setStatePlayers } from "../redux/actions";
import { getSortIcon } from "../../Common/Helpers/getSortIcon";
import { filterLeagues } from "../../Common/Helpers/filterLeagues";
import { getPlayersColumn } from "../helpers/getPlayersColumn";
import FilterIcons from "../../Common/Components/FilterIcons";

const PlayersCheck = ({ secondaryTable }) => {
  const dispatch = useDispatch();
  const { allplayers, state, ktc } = useSelector((state) => state.common);
  const { userPlayerShares, type1, type2, adpLm } = useSelector(
    (state) => state.user
  );
  const {
    column2,
    column3,
    column4,
    column5,
    sortBy,
    page,
    searched,
    itemActive,
    filters,
  } = useSelector((state) => state.players.primary);

  useFetchPlayerShares();

  const columnOptions = [
    "Owned",
    "Owned %",
    "W/L",
    "W %",
    "LM W/L",
    "LM W %",
    "ADP SF R",
    "ADP SF D",
    "ADP SF D-R",
    "Auction Budget% D",
    "Age",
    "KTC SF",
  ];

  const headers = [
    [
      {
        text: getSortIcon(1, sortBy, dispatch, setStatePlayers),
        colSpan: 5,
        className: "sort",
      },
      {
        text: getSortIcon(2, sortBy, dispatch, setStatePlayers),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(3, sortBy, dispatch, setStatePlayers),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(4, sortBy, dispatch, setStatePlayers),
        colSpan: 2,
        className: "sort",
      },
      {
        text: getSortIcon(5, sortBy, dispatch, setStatePlayers),
        colSpan: 2,
        className: "sort",
      },
    ],
    [
      {
        text: "Player",
        colSpan: 5,
        className: sortBy.column === 1 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column2}
            columnOptions={columnOptions}
            setState={(value) => dispatch(setStatePlayers({ column2: value }))}
          />
        ),
        colSpan: 2,
        className: sortBy.column === 2 ? "sorted" : "",
      },
      {
        text: (
          <HeaderDropdown
            column_text={column3}
            columnOptions={columnOptions}
            setState={(value) => dispatch(setStatePlayers({ column3: value }))}
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
            setState={(value) => dispatch(setStatePlayers({ column4: value }))}
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
            setState={(value) => dispatch(setStatePlayers({ column5: value }))}
          />
        ),
        colSpan: 2,
        className: sortBy.column === 5 ? "sorted" : "",
      },
    ],
  ];

  const body = (userPlayerShares || [])
    .filter(
      (x) =>
        (x.id.includes("_") &&
          (!searched?.id || searched?.id === x.id) &&
          filters.team === "All" &&
          (filters.draftClass === "All" ||
            filters.draftClass === x.id.split("_")[0]) &&
          ["All", "Picks"].includes(filters.position)) ||
        (allplayers?.[x.id] &&
          x.leagues_owned.length +
            x.leagues_taken.length +
            x.leagues_available.length >
            0 &&
          (!searched?.id || searched?.id === x.id) &&
          (filters.team === "All" ||
            allplayers?.[x.id]?.team === filters.team) &&
          (filters.draftClass === "All" ||
            parseInt(filters.draftClass) ===
              state.league_season - (allplayers[x.id]?.years_exp || 0)) &&
          (filters.position === allplayers[x.id]?.position ||
            filters.position
              .split("/")
              .includes(allplayers[x.id]?.position?.slice(0, 1))))
    )
    .map((player) => {
      let pick_name;

      if (player.id?.includes("_")) {
        const pick_split = player.id.split("_");

        pick_name = ["undefined", "NA"].includes(pick_split[2])
          ? `${pick_split[0]} Round ${pick_split[1]}`
          : `${pick_split[0]} ${pick_split[1]}.${pick_split[2].toLocaleString(
              "en-US",
              {
                minimumIntegerDigits: 2,
              }
            )}`;
      }

      const leagues_owned = filterLeagues(player.leagues_owned, type1, type2);
      const leagues_taken = filterLeagues(player.leagues_taken, type1, type2);
      const leagues_available = filterLeagues(
        player.leagues_available,
        type1,
        type2
      );

      const record_dict = leagues_owned.reduce(
        (acc, cur) => {
          return {
            wins: acc.wins + (cur.userRoster.settings.wins || 0),
            losses: acc.losses + (cur.userRoster.settings.losses || 0),
            ties: acc.ties + (cur.userRoster.settings.ties || 0),
            fp:
              acc.fp +
              parseFloat(
                (cur.userRoster.settings.fpts || 0) +
                  "." +
                  (cur.userRoster.settings.fpts_decimal || 0)
              ),
            fpa:
              acc.fp +
              parseFloat(
                (cur.userRoster.settings.fpts_against || 0) +
                  "." +
                  (cur.userRoster.settings.fpts_against_decimal || 0)
              ),
          };
        },
        {
          wins: 0,
          losses: 0,
          ties: 0,
          fp: 0,
          fpa: 0,
        }
      );

      const record =
        `${record_dict.wins}-${record_dict.losses}` +
        (record_dict.ties > 0 ? `-${record_dict.ties}` : "");
      const winpct =
        record_dict.wins + record_dict.losses + record_dict.ties > 0
          ? (
              record_dict.wins /
              (record_dict.wins + record_dict.losses + record_dict.ties)
            ).toFixed(4)
          : "-";

      const record_dict_lm = leagues_taken.reduce(
        (acc, cur) => {
          return {
            wins: acc.wins + (cur.lmRoster.settings.wins || 0),
            losses: acc.losses + (cur.lmRoster.settings.losses || 0),
            ties: acc.ties + (cur.lmRoster.settings.ties || 0),
            fp:
              acc.fp +
              parseFloat(
                (cur.lmRoster.settings.fpts || 0) +
                  "." +
                  (cur.userRoster.settings.fpts_decimal || 0)
              ),
            fpa:
              acc.fp +
              parseFloat(
                (cur.lmRoster.settings.fpts_against || 0) +
                  "." +
                  (cur.userRoster.settings.fpts_against_decimal || 0)
              ),
          };
        },
        {
          wins: 0,
          losses: 0,
          ties: 0,
          fp: 0,
          fpa: 0,
        }
      );

      const record_lm =
        `${record_dict_lm.wins}-${record_dict_lm.losses}` +
        (record_dict_lm.ties > 0 ? `-${record_dict_lm.ties}` : "");
      const winpct_lm =
        record_dict_lm.wins + record_dict_lm.losses + record_dict_lm.ties > 0
          ? (
              record_dict_lm.wins /
              (record_dict_lm.wins +
                record_dict_lm.losses +
                record_dict_lm.ties)
            ).toFixed(4)
          : "-";

      const sort =
        sortBy.column === 1
          ? allplayers[player.id]?.full_name
          : getPlayersColumn(
              [column2, column3, column4, column5][sortBy.column - 2],
              leagues_owned,
              leagues_taken,
              leagues_available,
              record,
              winpct,
              record_lm,
              winpct_lm,
              adpLm,
              player.id,
              allplayers,
              ktc
            ).sort;

      return {
        id: player.id,
        total_leagues: leagues_owned.length,
        sortBy: sortBy.column === 1 ? allplayers[player.id]?.full_name : sort,
        search: {
          text:
            (allplayers?.[player.id] &&
              `${allplayers?.[player.id]?.full_name} ${
                allplayers?.[player.id]?.position
              } ${allplayers?.[player.id]?.team || "FA"}`) ||
            pick_name,
          image: {
            src: player.id,
            alt: "player photo",
            type: "player",
          },
        },
        list: [
          {
            text: player.id?.includes("_")
              ? pick_name
              : `${allplayers?.[player.id]?.position} ${
                  allplayers?.[player.id]?.full_name
                } ${
                  player.id?.includes("_")
                    ? ""
                    : allplayers?.[player.id]?.team || "FA"
                }` || `INACTIVE PLAYER`,
            image: {
              src: allplayers?.[player.id] ? player.id : headshot,
              alt: allplayers?.[player.id]?.full_name || player.id,
              type: "player",
            },
            colSpan: 5,
            className: sortBy.column === 1 ? "sorted" : "",
          },
          ...[column2, column3, column4, column5].map((column, index) => {
            const { text, trendColor } = getPlayersColumn(
              column,
              leagues_owned,
              leagues_taken,
              leagues_available,
              record,
              winpct,
              record_lm,
              winpct_lm,
              adpLm,
              player.id,
              allplayers,
              ktc
            );

            return {
              text: (
                <span className="stat" style={trendColor}>
                  {text}
                </span>
              ),
              colSpan: 2,
              className: sortBy.column === index + 2 ? "sorted" : "",
            };
          }),
        ],
        secondary_table: secondaryTable({
          player_id: player.id,
          leagues_owned,
          leagues_taken,
          leagues_available,
        }),
      };
    })
    .sort((a, b) => {
      if (sortBy.asc) {
        return a.sortBy > b.sortBy ? 1 : -1;
      } else {
        return b.sortBy > a.sortBy ? 1 : -1;
      }
    });

  const draftClassYears = Array.from(
    new Set(
      (userPlayerShares || []).map(
        (player) =>
          state.league_season - (allplayers[player.id]?.years_exp || 0)
      )
    )
  );

  return (
    <TableMain
      type={"primary"}
      headers={headers}
      body={body}
      page={page}
      setPage={(value) => dispatch(setStatePlayers({ page: value }))}
      searched={searched}
      setSearched={(value) => dispatch(setStatePlayers({ searched: value }))}
      itemActive={itemActive}
      setItemActive={(value) =>
        dispatch(setStatePlayers({ itemActive: value }))
      }
      options1={[
        <FilterIcons
          type={"team"}
          filterTeam={filters.team}
          setFilterTeam={(value) =>
            dispatch(setStatePlayers({ filters: { ...filters, team: value } }))
          }
        />,
      ]}
      options2={[
        <FilterIcons
          type={"position"}
          filterPosition={filters.position}
          setFilterPosition={(value) =>
            dispatch(
              setStatePlayers({ filters: { ...filters, position: value } })
            )
          }
          picks={true}
        />,
        <FilterIcons
          type={"draft"}
          filterDraftClass={filters.draftClass}
          setFilterDraftClass={(value) =>
            dispatch(
              setStatePlayers({ filters: { ...filters, draftClass: value } })
            )
          }
          draftClassYears={draftClassYears}
        />,
      ]}
    />
  );
};

export default PlayersCheck;
