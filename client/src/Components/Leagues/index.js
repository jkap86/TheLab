import LeaguesCheck from "./components/LeaguesCheck";
import Standings from "../Common/Components/Standings";

const Leagues = () => {
  return <LeaguesCheck secondaryTable={(props) => <Standings {...props} />} />;
};

export default Leagues;
