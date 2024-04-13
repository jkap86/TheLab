import React, { Suspense } from "react";
import LoadingIcon from "../Common/Components/LoadingIcon";
const PlayersCheck = React.lazy(() => import("./components/PlayersCheck"));
const PlayerLeagues = React.lazy(() => import("./components/PlayerLeagues"));
const Standings = React.lazy(() => import("../Common/Components/Standings"));

const Players = () => {
  return (
    <Suspense fallback={<LoadingIcon />}>
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
    </Suspense>
  );
};

export default Players;
