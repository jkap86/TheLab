import TradesDisplay from "./TradesDisplay";
import useFetchLmTrades from "../hooks/useFetchLmTrades";
import { useSelector } from "react-redux";

const LmTrades = ({ secondaryTable }) => {
  const { trades: lmTrades } = useSelector((state) => state.trades.lmtrades);

  useFetchLmTrades();

  return <TradesDisplay trades={lmTrades} secondaryTable={secondaryTable} />;
};

export default LmTrades;
