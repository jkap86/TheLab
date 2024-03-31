import LeaguematesPrimary from "./components/LeaguematesPrimary";
import LeaguematesSecondary from "./components/LeaguematesSecondary";

const Leaguemates = () => {
  return (
    <LeaguematesPrimary
      secondaryTable={(props) => <LeaguematesSecondary {...props} />}
    />
  );
};

export default Leaguemates;
