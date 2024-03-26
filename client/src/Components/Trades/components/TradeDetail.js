import { setStateTradesNav } from "../redux/actions";
import { useSelector, useDispatch } from "react-redux";
import RostersComp from "./RostersComp";

const TradeDetail = ({ trade }) => {
  const dispatch = useDispatch();
  const { tabSecondary } = useSelector((state) => state.trades.nav);

  return (
    <>
      <div className="secondary nav">
        <button
          className={tabSecondary === "Leads" ? "active click" : "click"}
          onClick={() => dispatch(setStateTradesNav({ tabSecondary: "Leads" }))}
        >
          Leads
        </button>
        <button
          className={tabSecondary === "Rosters" ? "active click" : "click"}
          onClick={() =>
            dispatch(setStateTradesNav({ tabSecondary: "Rosters" }))
          }
        >
          Rosters
        </button>
      </div>
      {tabSecondary === "Rosters" ? <RostersComp trade={trade} /> : null}
    </>
  );
};

export default TradeDetail;
