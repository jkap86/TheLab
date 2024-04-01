export const getTradeTips = (trades, leagues, season) => {
  const trade_tips = [];

  trades.forEach((trade) => {
    let trade_away = [];

    Object.keys(trade.adds || {}).forEach((add) => {
      const lm_user_id = trade.adds[add];

      if (lm_user_id) {
        leagues
          .filter(
            (league) =>
              league.rosters.find((r) => r.user_id === lm_user_id) &&
              league.userRoster.user_id !== lm_user_id &&
              league.userRoster.players?.includes(add) &&
              league.league_id !== trade.leagueLeagueId
          )
          .forEach((league) => {
            const lmRoster = league.rosters.find(
              (r) => r.user_id === lm_user_id
            );

            trade_away.push({
              type: "player",
              player_id: add,
              manager: {
                user_id: lm_user_id,
                username: lmRoster?.username || "Orphan",
                avatar: lmRoster?.avatar,
              },
              league: {
                league_id: league.league_id,
                name: league.name,
                avatar: league.avatar,
                roster_positions: league.roster_positions,
              },
              userRoster: league.userRoster,
              lmRoster: league.rosters.find((r) => r.user_id === lm_user_id),
            });
          });
      }
    });

    trade.draft_picks.map((pick) => {
      const lm_user_id = pick.new_user.user_id;

      if (lm_user_id) {
        leagues
          .filter(
            (league) =>
              league.rosters.find((r) => r.user_id === lm_user_id) &&
              league.userRoster.user_id !== lm_user_id &&
              league.league_id !== trade.leagueLeagueId &&
              league.userRoster.draft_picks.find(
                (pickUser) =>
                  parseInt(pick.season) === pickUser.season &&
                  pick.round === pickUser.round &&
                  (pick.order === pickUser.order ||
                    parseInt(pick.season) > parseInt(season))
              )
          )
          .forEach((league) => {
            const lmRoster = league.rosters.find(
              (r) => r.user_id === lm_user_id
            );

            const pickname =
              parseInt(pick.season) === parseInt(season) && parseInt(pick.order)
                ? `${pick.season} ${pick.round}.${
                    parseInt(pick.season) === parseInt(season) &&
                    pick.order?.toLocaleString("en-US", {
                      minimumIntegerDigits: 2,
                    })
                  }`
                : `${pick.season} Round ${pick.round}`;

            trade_away.push({
              type: "pick",
              player_id: pickname,
              manager: {
                user_id: lm_user_id,
                username: lmRoster?.username || "Orphan",
                avatar: lmRoster?.avatar,
              },
              league: {
                league_id: league.league_id,
                name: league.name,
                avatar: league.avatar,
                roster_positions: league.roster_positions,
              },
              userRoster: league.userRoster,
              lmRoster: league.rosters.find((r) => r.user_id === lm_user_id),
            });
          });
      }
    });

    let acquire = [];

    Object.keys(trade.drops || {}).forEach((drop) => {
      const lm_user_id = trade.drops[drop];

      if (lm_user_id) {
        leagues
          .filter(
            (league) =>
              league.rosters.find(
                (r) => r.user_id === lm_user_id && r.players?.includes(drop)
              ) &&
              league.userRoster.user_id !== lm_user_id &&
              league.league_id !== trade.leagueLeagueId
          )
          .forEach((league) => {
            const lmRoster = league.rosters.find(
              (r) => r.user_id === lm_user_id
            );

            acquire.push({
              type: "player",
              player_id: drop,
              manager: {
                user_id: lm_user_id,
                username: lmRoster?.username || "Orphan",
                avatar: lmRoster?.avatar,
              },
              league: {
                league_id: league.league_id,
                name: league.name,
                avatar: league.avatar,
                roster_positions: league.roster_positions,
              },
              userRoster: league.userRoster,
              lmRoster: league.rosters.find((r) => r.user_id === lm_user_id),
            });
          });
      }
    });

    trade.draft_picks.map((pick) => {
      const lm_user_id = pick.old_user.user_id;

      if (lm_user_id) {
        leagues
          .filter(
            (league) =>
              league.rosters.find(
                (r) =>
                  r.user_id === lm_user_id &&
                  r.draft_picks.find(
                    (pickUser) =>
                      parseInt(pick.season) === pickUser.season &&
                      pick.round === pickUser.round &&
                      parseInt(pick.order) &&
                      parseInt(pickUser.order) &&
                      pick.order === pickUser.order
                  )
              ) &&
              league.userRoster.user_id !== lm_user_id &&
              league.league_id !== trade.leagueLeagueId
          )
          .forEach((league) => {
            const lmRoster = league.rosters.find(
              (r) => r.user_id === lm_user_id
            );

            const pickname =
              parseInt(pick.season) === parseInt(season) && pick.order
                ? `${pick.season} ${pick.round}.${pick.order.toLocaleString(
                    "en-US",
                    { minimumIntegerDigits: 2 }
                  )}`
                : `${pick.season} Round ${pick.round}`;

            acquire.push({
              type: "pick",
              player_id: pickname,
              manager: {
                user_id: lm_user_id,
                username: lmRoster?.username || "Orphan",
                avatar: lmRoster?.avatar,
              },
              league: {
                league_id: league.league_id,
                name: league.name,
                avatar: league.avatar,
                roster_positions: league.roster_positions,
              },
              userRoster: league.userRoster,
              lmRoster: league.rosters.find((r) => r.user_id === lm_user_id),
            });
          });
      }
    });

    trade_tips.push({
      ...trade,
      tips: {
        trade_away: trade_away,
        acquire: acquire,
      },
    });
  });

  return trade_tips;
};
