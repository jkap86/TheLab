import React, { Suspense } from "react";
import LeaguesCheck from "./components/LeaguesCheck";
import LoadingIcon from "../Common/Components/LoadingIcon";
const Standings = React.lazy(() => import("../Common/Components/Standings"));

const Leagues = () => {
  return (
    <LeaguesCheck
      secondaryTable={(props) => (
        <Suspense fallback={<LoadingIcon />}>
          <Standings {...props} />
        </Suspense>
      )}
    />
  );
};

export default Leagues;
