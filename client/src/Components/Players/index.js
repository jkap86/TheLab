import React, { Suspense } from "react";
import PlayersCheck from "./components/PlayersCheck";
import LoadingIcon from "../Common/Components/LoadingIcon";
const PlayerLeagues = React.lazy(() => import("./components/PlayerLeagues"));
const Standings = React.lazy(() => import("../Common/Components/Standings"));

const Players = () => {
  return (
    <PlayersCheck
      secondaryTable={(props) => (
        <Suspense fallback={<LoadingIcon />}>
          <PlayerLeagues
            {...props}
            secondaryTable={(props2) => (
              <Suspense fallback={<LoadingIcon />}>
                <Standings {...props2} />{" "}
              </Suspense>
            )}
          />
        </Suspense>
      )}
    />
  );
};

export default Players;
