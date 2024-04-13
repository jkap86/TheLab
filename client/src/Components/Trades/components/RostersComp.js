import Roster from "../../Common/Components/Roster";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import {
  getRosterPicksValue,
  getPlayersValue,
} from "../../Common/Helpers/rosterValues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";
import { getLeagueRankings } from "../../Leagues/helpers/getLeagueRankings";

const RostersComp = ({ trade }) => {
  const [filter1, setFilter1] = useState("All");
  const [filter2, setFilter2] = useState("All");
  const [roster1, setRoster1] = useState(Object.values(trade.rosters)[0]);
  const [roster2, setRoster2] = useState(Object.values(trade.rosters)[1]);
  const [valueType, setValueType] = useState("D ADP");
  const { allplayers, state, ktc } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);

  const standingsType = valueType.startsWith("D") ? "Dynasty" : "Redraft";

  const rosters_array = Object.keys(trade.rosters).map((roster_id) => {
    return {
      ...trade.rosters[roster_id],
      roster_id: roster_id,
    };
  });

  const standings_detail = getLeagueRankings({
    league: {
      avatar: trade["league.avatar"],
      league_id: trade["league.league_id"],
      name: trade["league.name"],
      roster_positions: trade["league.roster_positions"],
      scoring_settings: trade["league.scoring_settings"],
      settings: trade["league.settings"],
      rosters: rosters_array,
    },
    adpLm,
    allplayers,
    ktc,
    state,
  });

  useEffect(() => {
    setRoster1(standings_detail[0]);
    setRoster2(standings_detail[1]);
  }, [standings_detail]);

  return (
    <>
      <div className="secondary nav">
        <div>
          <div>
            <HeaderDropdown
              column_text={filter1}
              columnOptions={["All", "QB", "RB", "WR", "TE", "Picks"]}
              setState={setFilter1}
            />
          </div>
          {Object.keys(trade.rosters).length > 2 ? (
            <HeaderDropdown
              column_text={roster1.username}
              columnOptions={Object.values(trade.rosters)
                .filter(
                  (trade_roster) => trade_roster.roster_id !== roster2.roster_id
                )
                .map((trade_roster) => trade_roster.username)}
              setState={setRoster1}
            />
          ) : (
            <span className="username">{roster1.username || "Orphan"}</span>
          )}
          <div></div>
          <div></div>
        </div>
        <div>
          <div>
            <HeaderDropdown
              column_text={filter2}
              columnOptions={["All", "QB", "RB", "WR", "TE", "Picks"]}
              setState={setFilter2}
            />
          </div>
          {Object.keys(trade.rosters).length > 2 ? (
            <HeaderDropdown
              column_text={roster2.username}
              columnOptions={Object.values(trade.rosters)
                .filter(
                  (trade_roster) => trade_roster.roster_id !== roster1.roster_id
                )
                .map((trade_roster) => trade_roster.username)}
              setState={setRoster2}
            />
          ) : (
            <span className="username">{roster2.username || "Orphan"}</span>
          )}
          <div></div>
          <div></div>
        </div>
      </div>
      <Roster
        type={"secondary half"}
        roster={{
          ...roster1,
          starters: valueType.startsWith("D")
            ? roster1.starters_optimal_dynasty
            : roster1.starters_optimal_redraft,
        }}
        league={{
          avatar: trade["league.avatar"],
          league_id: trade["league.league_id"],
          name: trade["league.name"],
          roster_positions: trade["league.roster_positions"],
          settings: trade["league.settings"],
          rosters: Object.keys(trade.rosters).map((rid) => {
            return {
              ...trade.rosters[rid],
              roster_id: rid,
            };
          }),
        }}
        filter={filter1}
        standingsType={standingsType}
        valueType={valueType}
        setValueType={setValueType}
      />
      <Roster
        type={"secondary half"}
        roster={{
          ...roster2,
          starters: valueType.startsWith("D")
            ? roster2.starters_optimal_dynasty
            : roster2.starters_optimal_redraft,
        }}
        league={{
          avatar: trade["league.avatar"],
          league_id: trade["league.league_id"],
          name: trade["league.name"],
          roster_positions: trade["league.roster_positions"],
          settings: trade["league.settings"],
          rosters: Object.keys(trade.rosters).map((rid) => {
            return {
              ...trade.rosters[rid],
              roster_id: rid,
            };
          }),
        }}
        filter={filter2}
        standingsType={standingsType}
        valueType={valueType}
        setValueType={setValueType}
      />
    </>
  );
};

export default RostersComp;
