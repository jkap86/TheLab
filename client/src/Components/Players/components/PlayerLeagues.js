import { useDispatch, useSelector } from "react-redux";
import { setStatePlayers } from "../redux/actions";
import React, { Suspense } from "react";
import LoadingIcon from "../../Common/Components/LoadingIcon";

const LeaguesOwned = React.lazy(() => import("./LeaguesOwned"));

const PlayerLeagues = ({
  secondaryTable,
  player_id,
  leagues_owned,
  leagues_taken,
  leagues_available,
}) => {
  const dispatch = useDispatch();
  const { tabSecondary } = useSelector((state) => state.players.primary);

  const columnOptionsCommon = [
    "Picks Rank",
    "Players Rank D",
    "Rank D",
    "Rank R",
  ];

  const columnOptions = [
    ...columnOptionsCommon,
    ...(tabSecondary === "Taken"
      ? columnOptionsCommon.map((colname) => `LM ${colname}`)
      : []),
    "League ID",
  ];

  return (
    <>
      <div className="secondary nav">
        <button
          className={tabSecondary === "Owned" ? "active click" : "click"}
          onClick={(e) => dispatch(setStatePlayers({ tabSecondary: "Owned" }))}
        >
          Owned
        </button>
        <button
          className={tabSecondary === "Taken" ? "active click" : "click"}
          onClick={(e) => dispatch(setStatePlayers({ tabSecondary: "Taken" }))}
        >
          Taken
        </button>
        {player_id.includes("_") ? (
          ""
        ) : (
          <>
            <button
              className={
                tabSecondary === "Available" ? "active click" : "click"
              }
              onClick={(e) =>
                dispatch(setStatePlayers({ tabSecondary: "Available" }))
              }
            >
              Available
            </button>
            <button
              className={
                tabSecondary === "Leaguemate Shares" ? "active click" : "click"
              }
              onClick={(e) =>
                dispatch(setStatePlayers({ tabSecondary: "Leaguemate Shares" }))
              }
            >
              Leaguemate Shares
            </button>
          </>
        )}
      </div>
      <Suspense fallback={<LoadingIcon />}>
        {tabSecondary === "Owned" ? (
          <LeaguesOwned
            secondaryTable={secondaryTable}
            leagues_owned={leagues_owned}
            columnOptions={columnOptions}
          />
        ) : tabSecondary === "Taken" ? (
          <LeaguesOwned
            secondaryTable={secondaryTable}
            leagues_taken={leagues_taken}
            columnOptions={columnOptions}
          />
        ) : (
          <LeaguesOwned
            secondaryTable={secondaryTable}
            leagues_available={leagues_available}
            columnOptions={columnOptions}
          />
        )}
      </Suspense>
    </>
  );
};
export default PlayerLeagues;
