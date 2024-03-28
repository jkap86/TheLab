import TradesDisplay from "./TradesDisplay";
import useFetchLmTrades from "../hooks/useFetchLmTrades";
import useFetchFilteredLmTrades from "../hooks/useFetchFilteredLmTrades";
import Search from "../../Common/Components/Search";
import { useSelector, useDispatch } from "react-redux";
import { fetchLmTrades } from "../redux/actions";
import { setStateLmTrades } from "../redux/actions";

const LmTrades = ({ secondaryTable, players_list, managers_list }) => {
  const dispatch = useDispatch();
  const { state } = useSelector((state) => state.common);
  const { user_id, leagues, lmLeagueIds } = useSelector((state) => state.user);
  const {
    trades,
    isLoading,
    count,
    searched_player,
    searched_manager,
    searches,
  } = useSelector((state) => state.trades.lmtrades);

  useFetchLmTrades();

  useFetchFilteredLmTrades();

  const loadMore = async () => {
    console.log("LOADING MORE");

    if (searched_player === "" && searched_manager === "") {
      dispatch(
        fetchLmTrades(
          user_id,
          leagues,
          lmTrades.length,
          125,
          state.league_season,
          lmLeagueIds,
          true
        )
      );
    }
  };

  const lmTrades =
    searched_player.id || searched_manager.id
      ? searches.find(
          (s) =>
            s.player === searched_player.id && s.manager === searched_manager.id
        )?.trades
      : trades;

  const searchBar = (
    <div className="trade_search_wrapper">
      <Search
        id={"By Player"}
        placeholder={`Player`}
        list={players_list}
        searched={searched_player}
        setSearched={(searched) =>
          dispatch(setStateLmTrades({ searched_player: searched }))
        }
      />
      <Search
        id={"By Manager"}
        placeholder={`Manager`}
        list={managers_list}
        searched={searched_manager}
        setSearched={(searched) =>
          dispatch(setStateLmTrades({ searched_manager: searched }))
        }
      />
    </div>
  );

  return (
    <TradesDisplay
      trades={lmTrades}
      count={count}
      secondaryTable={secondaryTable}
      loadMore={loadMore}
      isLoading={isLoading}
      searchBar={searchBar}
    />
  );
};

export default LmTrades;
