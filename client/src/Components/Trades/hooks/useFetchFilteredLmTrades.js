import { useEffect } from "react";
import { fetchFilteredLmTrades } from "../redux/actions";
import { useSelector, useDispatch } from "react-redux";

const useFetchFilteredLmTrades = () => {
  const dispatch = useDispatch();
  const { state } = useSelector((state) => state.common);
  const { user_id, leagues, lmLeagueIds } = useSelector((state) => state.user);
  const {
    trades: lmTrades,
    isLoading,
    searched_player,
    searched_manager,
    searches,
  } = useSelector((state) => state.trades.lmtrades);

  console.log({ searches });
  useEffect(() => {
    if (
      !isLoading &&
      (searched_player.id || searched_manager.id) &&
      !searches.find(
        (s) =>
          s.player === searched_player.id && s.manager === searched_manager.id
      )
    ) {
      console.log("fetching filtered lm trades");
      dispatch(
        fetchFilteredLmTrades(
          searched_player.id,
          searched_manager.id,
          user_id,
          leagues,
          0,
          125,
          state.league_season,
          lmLeagueIds
        )
      );
    }
  }, [searched_player, searched_manager, searches, dispatch]);
};

export default useFetchFilteredLmTrades;
