import TradesNav from "./components/TradesNav";
import { useSelector } from "react-redux";
import PcTrades from "./components/PcTrades";
import LmTrades from "./components/LmTrades";
import "./components/Trades.css";

const Trades = () => {
  const { tabPrimary } = useSelector((state) => state.trades.nav);

  const TradesPrimary = () => {
    return tabPrimary === "Price Check" ? <PcTrades /> : <LmTrades />;
  };

  return (
    <>
      <TradesNav />
      <TradesPrimary />
    </>
  );
};

export default Trades;
