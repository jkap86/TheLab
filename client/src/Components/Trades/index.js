import { useSelector } from "react-redux";
import PcTrades from "./components/PcTrades";
import LmTrades from "./components/LmTrades";
import "./components/Trades.css";
import TradeDetail from "./components/TradeDetail";

const Trades = () => {
  const { tabPrimary } = useSelector((state) => state.trades.nav);

  const TradesPrimary = ({ secondaryTable }) => {
    return tabPrimary === "Price Check" ? (
      <PcTrades secondaryTable={secondaryTable} />
    ) : (
      <LmTrades secondaryTable={secondaryTable} />
    );
  };

  return (
    <>
      <TradesPrimary secondaryTable={(props) => <TradeDetail {...props} />} />
    </>
  );
};

export default Trades;
