import { setStateTradesNav } from "../redux/actions";
import { useSelector, useDispatch } from "react-redux";

const TradesNav = () => {
  const dispatch = useDispatch();
  const { tabPrimary } = useSelector((state) => state.trades.nav);

  return (
    <h2>
      <select
        value={tabPrimary}
        onChange={(e) =>
          dispatch(setStateTradesNav({ tabPrimary: e.target.value }))
        }
        className="active click"
      >
        <option>Price Check</option>
        <option>Leaguemate League Trades</option>
      </select>
    </h2>
  );
};

export default TradesNav;
