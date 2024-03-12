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

const LeaguesCheck = ({ secondaryTable }) => {
  const dispatch = useDispatch();
  const { allplayers, state } = useSelector((state) => state.common);
  const {
    leagues,
    type1,
    type2,
    adpLm,
    isLoadingAdp,
    isLoadingUser,
    isLoadingLeagues,
  } = useSelector((state) => state.user);
  const { column1, column2, column3, column4, itemActive, page } = useSelector(
    (state) => state.leagues.LeaguesCheck
  );

  const columnOptions = [
    "Picks Rank",
    "Players Rank D",
    "Rank D",
    "Rank R",
    "League ID",
  ];

  const headers = [
    [
      {
        text: <span>League</span>,
        colSpan: 6,
        rowSpan: 2,
      },
      {
        text: (
          <HeaderDropdown
            column_text={column1}
            columnOptions={columnOptions}
            setState={(value) =>
              dispatch(setStateLeaguesCheck({ column1: value }))
            }
          />
        ),
        colSpan: 3,
        className: "left",
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
        className: "left",
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
        className: "left",
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
        className: "left",
      },
    ],
  ];

  const isLoading = !adpLm;

  const body = filterLeagues(leagues, type1, type2).map((league) => {
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

      if (
        league.name.includes("UCTION") &&
        roster.roster_id === league.userRoster.roster_id
      ) {
        console.log({ dynasty_optimal });
      }

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
        redraft_starters,
        redraft_bench,
        dynasty_optimal,
        redraft_optimal,
        starters_optimal_dynasty: optimal_dynasty_player_ids,
        starters_optimal_redraft: optimal_redraft_player_ids,
      };
    });

    return {
      id: league.league_id,
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
        },
        {
          ...getColumnValue(league, column1, isLoading, standings_detail),
        },
        {
          ...getColumnValue(league, column2, isLoading, standings_detail),
        },
        {
          ...getColumnValue(league, column3, isLoading, standings_detail),
        },
        {
          ...getColumnValue(league, column4, isLoading, standings_detail),
        },
      ],
      secondary_table: secondaryTable({
        league: {
          ...league,
          rosters: standings_detail,
        },
        type: "secondary",
      }),
    };
  });

  return (
    <TableMain
      type={"primary"}
      headers={headers}
      body={body}
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
