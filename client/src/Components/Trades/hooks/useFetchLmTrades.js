import { fetchLmTrades } from "../redux/actions";
import { useSelector, useDispatch } from "react-redux";
import { useEffect } from "react";

const useFetchLmTrades = () => {
  const dispatch = useDispatch();
  const { state } = useSelector((state) => state.common);
  const { user_id, leagues, lmLeagueIds } = useSelector((state) => state.user);
  const { trades } = useSelector((state) => state.trades.lmtrades);

  useEffect(() => {
    if (state && lmLeagueIds && !trades) {
      dispatch(
        fetchLmTrades(
          user_id,
          leagues,
          0,
          125,
          state.league_season,
          lmLeagueIds
        )
      );
    }
  }, [dispatch, state, user_id, leagues, lmLeagueIds]);
};

export default useFetchLmTrades;
