import Roster from "../../Common/Components/Roster";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import {
  getRosterPicksValue,
  getPlayersValue,
} from "../../Common/Helpers/rosterValues";
import { getOptimalLineupADP } from "../../Common/Helpers/getOptimalLineupADP";

const RostersComp = ({ trade }) => {
  const [filter1, setFilter1] = useState("All");
  const [filter2, setFilter2] = useState("All");
  const [roster1, setRoster1] = useState(
    Object.values(trade.rosters)[0].username
  );
  const [roster2, setRoster2] = useState(
    Object.values(trade.rosters)[1].username
  );
  const [valueType, setValueType] = useState("D ADP");
  const { allplayers, state } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);

  const standingsType = valueType.startsWith("D") ? "Dynasty" : "Redraft";

  const rosters_array = Object.keys(trade.rosters).map((player_id) => {
    return {
      ...trade.rosters[player_id],
      player_id: player_id,
    };
  });

  const standings_detail = rosters_array.map((roster) => {
    const dynasty_picks = getRosterPicksValue(
      roster.draft_picks,
      "Dynasty",
      adpLm,
      state.season
    );

    const dynasty_optimal = getOptimalLineupADP({
      roster,
      roster_positions: trade["league.roster_positions"],
      adpLm,
      allplayers,
      type: "Dynasty",
    });

    const optimal_dynasty_player_ids = dynasty_optimal.map(
      (slot) => slot.player_id
    );

    const dynasty_starters = getPlayersValue(
      optimal_dynasty_player_ids,
      "Dynasty",
      adpLm
    );

    const dynasty_bench = getPlayersValue(
      roster.players?.filter(
        (player_id) => !optimal_dynasty_player_ids.includes(player_id)
      ),
      "Dynasty",
      adpLm
    );

    const redraft_optimal = getOptimalLineupADP({
      roster,
      roster_positions: trade["league.roster_positions"],
      adpLm,
      allplayers,
      type: "Redraft",
    });

    const optimal_redraft_player_ids = redraft_optimal.map(
      (slot) => slot.player_id
    );

    const redraft_starters = getPlayersValue(
      optimal_redraft_player_ids,
      "Redraft",
      adpLm
    );

    const redraft_bench = getPlayersValue(
      roster.players?.filter(
        (player_id) => !optimal_redraft_player_ids.includes(player_id)
      ),
      "Redraft",
      adpLm
    );

    return {
      ...roster,
      dynasty_picks,
      dynasty_starters,
      dynasty_bench,
      dynasty_players: dynasty_starters + dynasty_bench,
      dynasty_total: dynasty_starters + dynasty_bench + dynasty_picks,
      redraft_starters,
      redraft_bench,
      redraft_total: redraft_starters + redraft_bench,
      dynasty_optimal,
      redraft_optimal,
      starters_optimal_dynasty: optimal_dynasty_player_ids,
      starters_optimal_redraft: optimal_redraft_player_ids,
    };
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
                  (player_id) => trade.rosters[player_id].username !== roster2
                )
                .map((player_id) => trade.rosters[player_id].username)}
              setState={setRoster1}
            />
          ) : (
            <span className="username">{roster1.username}</span>
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
                  (player_id) => trade.rosters[player_id].username !== roster1
                )
                .map((player_id) => trade.rosters[player_id].username)}
              setState={setRoster2}
            />
          ) : (
            <span className="username">{roster2.username}</span>
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
