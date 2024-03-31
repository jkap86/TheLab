import { useDispatch, useSelector } from "react-redux";
import { setStatePlayers } from "../redux/actions";
import React, { Suspense } from "react";
import LoadingIcon from "../../Common/Components/LoadingIcon";
import { getColumnOptionsLeagues } from "../../Leagues/helpers/columnOptionsLeagues";
const LeaguesOwned = React.lazy(() => import("./LeaguesOwned"));

const PlayerLeagues = ({
  secondaryTable,
  player_id,
  leagues_owned,
  leagues_taken,
  leagues_available,
}) => {
  const dispatch = useDispatch();
  const { tabSecondary, page_owned, page_taken, page_available } = useSelector(
    (state) => state.players.primary
  );

  const columnOptionsCommon = [
    "Picks Rank",
    "Players Rank D",
    "Rank D",
    "Rank R",
  ];

  const columnOptions = getColumnOptionsLeagues(
    tabSecondary === "Taken" ? true : false
  );

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
            page={page_owned}
            setPage={(value) =>
              dispatch(setStatePlayers({ page_owned: value }))
            }
          />
        ) : tabSecondary === "Taken" ? (
          <LeaguesOwned
            secondaryTable={secondaryTable}
            leagues_taken={leagues_taken}
            columnOptions={columnOptions}
            page={page_taken}
            setPage={(value) =>
              dispatch(setStatePlayers({ page_taken: value }))
            }
          />
        ) : (
          <LeaguesOwned
            secondaryTable={secondaryTable}
            leagues_available={leagues_available}
            columnOptions={columnOptions}
            page={page_available}
            setPage={(value) =>
              dispatch(setStatePlayers({ page_available: value }))
            }
          />
        )}
      </Suspense>
    </>
  );
};
export default PlayerLeagues;
