import React, { Suspense } from "react";
import LoadingIcon from "../Common/Components/LoadingIcon";
const LeaguesCheck = React.lazy(() => import("./components/LeaguesCheck"));
const Standings = React.lazy(() => import("../Common/Components/Standings"));

const Leagues = () => {
  return (
    <Suspense fallback={<LoadingIcon />}>
      <LeaguesCheck
        secondaryTable={(props) => (
          <Suspense fallback={<LoadingIcon />}>
            <Standings {...props} />
          </Suspense>
        )}
      />
    </Suspense>
  );
};

export default Leagues;
