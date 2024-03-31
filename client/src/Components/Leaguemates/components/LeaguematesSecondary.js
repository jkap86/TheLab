import LeaguemateLeagues from "./LeaguemateLeagues";

const LeaguematesSecondary = ({ leaguemate }) => {
  return (
    <>
      <div className="secondary nav"></div>
      <LeaguemateLeagues leaguemate={leaguemate} />
    </>
  );
};

export default LeaguematesSecondary;
