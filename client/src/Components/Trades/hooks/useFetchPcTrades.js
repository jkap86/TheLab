import { fetchPriceCheckTrades } from "../redux/actions";
import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";

const useFetchPcTrades = () => {
  const dispatch = useDispatch();
  const { state } = useSelector((state) => state.common);
  const { user_id, leagues, type1, type2 } = useSelector((state) => state.user);
  const { searches, pricecheck_player, pricecheck_player2, isLoading } =
    useSelector((state) => state.trades.pctrades);

  useEffect(() => {
    if (
      !isLoading &&
      pricecheck_player.id &&
      !searches.find(
        (pc) =>
          pc.pricecheck_player === pricecheck_player.id &&
          (!pricecheck_player2?.id ||
            pc.pricecheck_player2 === pricecheck_player2.id)
      )
    ) {
      dispatch(
        fetchPriceCheckTrades(
          pricecheck_player.id,
          pricecheck_player2.id,
          0,
          125
        )
      );
    }
  }, [pricecheck_player, isLoading, pricecheck_player2, searches, dispatch]);
};

export default useFetchPcTrades;
