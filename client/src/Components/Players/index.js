import React, { Suspense } from "react";
import PlayersCheck from "./components/PlayersCheck";
import LoadingIcon from "../Common/Components/LoadingIcon";
const PlayerLeagues = React.lazy(() => import("./components/PlayerLeagues"));

const Players = () => {
  return (
    <PlayersCheck
      secondaryTable={(props) => (
        <Suspense fallback={<LoadingIcon />}>
          <PlayerLeagues {...props} />
        </Suspense>
      )}
    />
  );
};

export default Players;
