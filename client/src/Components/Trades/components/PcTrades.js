import TradesDisplay from "./TradesDisplay";
import { useSelector, useDispatch } from "react-redux";
import Search from "../../Common/Components/Search";
import { setStatePcTrades } from "../redux/actions";
import useFetchPcTrades from "../hooks/useFetchPcTrades";

const PcTrades = ({ secondaryTable, players_list }) => {
  const dispatch = useDispatch();
  const {
    isLoading,
    count,
    pricecheck_player,
    pricecheck_player2,
    searches,
    page,
    itemActive,
  } = useSelector((state) => state.trades.pctrades);

  useFetchPcTrades();

  const pcTrades =
    searches.find(
      (s) =>
        s.pricecheck_player === pricecheck_player.id &&
        s.pricecheck_player2 === pricecheck_player2.id
    )?.trades || [];

  console.log({ searches });

  const searchBar = (
    <div className="trade_search_wrapper">
      <Search
        id={"By Player"}
        placeholder={`Player`}
        list={players_list}
        searched={pricecheck_player}
        setSearched={(searched) =>
          dispatch(
            setStatePcTrades({
              pricecheck_player: searched,
            })
          )
        }
      />
      {!pricecheck_player?.id ? null : (
        <>
          <Search
            id={"By Player"}
            placeholder={`Player`}
            list={players_list}
            searched={pricecheck_player2}
            setSearched={(searched) =>
              dispatch(
                setStatePcTrades({
                  pricecheck_player2: searched,
                })
              )
            }
          />
        </>
      )}
    </div>
  );

  const loadMore = console.log;

  return (
    <TradesDisplay
      trades={pcTrades}
      count={count}
      secondaryTable={secondaryTable}
      loadMore={loadMore}
      isLoading={isLoading}
      searchBar={searchBar}
      page={page}
      itemActive={itemActive}
    />
  );
};

export default PcTrades;
