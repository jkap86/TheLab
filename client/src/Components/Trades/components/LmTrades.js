import TradesDisplay from "./TradesDisplay";
import useFetchLmTrades from "../hooks/useFetchLmTrades";
import { useSelector } from "react-redux";

const LmTrades = () => {
  const { trades: lmTrades } = useSelector((state) => state.trades.lmtrades);

  useFetchLmTrades();

  return <TradesDisplay trades={lmTrades} />;
};

export default LmTrades;
