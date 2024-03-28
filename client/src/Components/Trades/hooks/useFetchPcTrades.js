import { fetchPriceCheckTrades } from "../../redux/actions";
import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";

const useFetchPcTrades = () => {
    const dispatch = useDispatch();
    const { state } = useSelector(state => state.common);
    const { user_id, leagues, type1, type2 } = useSelector(state => state.user);
    const { trade_date, pricecheckTrades, isLoading } = useSelector(state => state.trades);



    useEffect(() => {
        if (
            !isLoading
            && pricecheckTrades.pricecheck_player.id
            && !pricecheckTrades.searches
                .find(
                    pc => pc.pricecheck_player === pricecheckTrades.pricecheck_player.id
                        && (
                            !pricecheckTrades.pricecheck_player2?.id
                            || pc.pricecheck_player2 === pricecheckTrades.pricecheck_player2.id
                        )
                )
        ) {
            dispatch(fetchPriceCheckTrades(pricecheckTrades.pricecheck_player.id, pricecheckTrades.pricecheck_player2.id, 0, 125))
        }
    }, [pricecheckTrades.pricecheck_player, isLoading, pricecheckTrades.pricecheck_player2, pricecheckTrades.searches, dispatch])

}

export default useFetchPcTrades;