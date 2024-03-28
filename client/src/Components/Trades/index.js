import { useSelector } from "react-redux";
import PcTrades from "./components/PcTrades";
import LmTrades from "./components/LmTrades";
import "./components/Trades.css";
import TradeDetail from "./components/TradeDetail";
import {
  getPlayersList,
  getPicksList,
  getManagersList,
} from "./helpers/getSearchLists";

const Trades = () => {
  const { state, allplayers } = useSelector((state) => state.common);
  const { leagues } = useSelector((state) => state.user);
  const { tabPrimary } = useSelector((state) => state.trades.nav);

  const picks_list = getPicksList(state.league_season);

  const players_list = getPlayersList(leagues, allplayers, picks_list);

  const managers_list = getManagersList(leagues);

  const TradesPrimary = ({ secondaryTable }) => {
    return tabPrimary === "Price Check" ? (
      <PcTrades secondaryTable={secondaryTable} />
    ) : (
      <LmTrades
        secondaryTable={secondaryTable}
        players_list={players_list}
        managers_list={managers_list}
      />
    );
  };

  return (
    <>
      <TradesPrimary secondaryTable={(props) => <TradeDetail {...props} />} />
    </>
  );
};

export default Trades;
