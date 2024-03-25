import { setStateTradesNav } from "../redux/actions";
import { useSelector, useDispatch } from "react-redux";
import Roster from "../../Common/Components/Roster";

const TradeDetail = ({ trade }) => {
  const dispatch = useDispatch();
  const { tabSecondary } = useSelector((state) => state.trades.nav);

  console.log({ trade });
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
      {tabSecondary === "Rosters" ? (
        <>
          <Roster
            type={"secondary half"}
            roster={trade.rosters[Object.keys(trade.rosters)[0]]}
            league={{
              avatar: trade["league.avatar"],
              league_id: trade["league.league_id"],
              name: trade["league.name"],
              roster_positions: trade["league.roster_positions"],
              settings: trade["league.settings"],
              rosters: trade.rosters,
            }}
            filter={"All"}
            standingsType={"Dynasty"}
            valueType={"ADP"}
          />
          <Roster
            type={"secondary half"}
            roster={trade.rosters[Object.keys(trade.rosters)[1]]}
            league={{
              avatar: trade["league.avatar"],
              league_id: trade["league.league_id"],
              name: trade["league.name"],
              roster_positions: trade["league.roster_positions"],
              settings: trade["league.settings"],
              rosters: Object.keys(trade.rosters).map((rid) => {
                return {
                  ...trade.rosters[rid],
                  roster_id: rid,
                };
              }),
            }}
            filter={"All"}
            standingsType={"Dynasty"}
            valueType={"ADP"}
          />
        </>
      ) : null}
    </>
  );
};

export default TradeDetail;
