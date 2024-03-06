"use strict";

const axiosInstance = require("../api/axiosInstance");

const fetchState = async () => {
  const state = await axiosInstance.get("https://api.sleeper.app/v1/state/nfl");

  return state.data;
};

const fetchAllPlayers = async () => {
  const allplayers = await axiosInstance.get(
    "https://api.sleeper.app/v1/players/nfl"
  );

  return allplayers.data;
};

const fetchUser = async (username) => {
  const user = await axiosInstance.get(
    `https://api.sleeper.app/v1/user/${username}`
  );

  return user.data;
};

const fetchUserLeagues = async (user_id, season) => {
  const leagues = await axiosInstance.get(
    `https://api.sleeper.app/v1/user/${user_id}/leagues/nfl/${season}`
  );

  return leagues.data;
};

const fetchLeague = async (league_id) => {
  const league = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}`
  );

  return league.data;
};

const fetchLeagueRosters = async (league_id) => {
  const rosters = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}/rosters`
  );

  return rosters.data;
};

const fetchLeagueUsers = async (league_id) => {
  const users = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}/users`
  );

  return users.data;
};

const fetchLeagueDrafts = async (league_id) => {
  const drafts = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}/drafts`
  );

  return drafts.data;
};

const fetchLeagueTradedPicks = async (league_id) => {
  const traded_picks = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}/traded_picks`
  );

  return traded_picks.data;
};

const fetchStats = async (season, week) => {
  const season_type = "post";
  const positions = ["QB", "RB", "WR", "TE"];

  const stats = [];

  for (const position of positions) {
    const stats_position = await axiosInstance.get(
      `https://api.sleeper.com/stats/nfl/${season}/${week}?season_type=${season_type}&position[]=${position}&order_by=ppr`
    );

    stats.push(stats_position.data);
  }

  return stats.flat();
};

const fetchProjections = async (season, week) => {
  const season_type = "post";
  const positions = ["QB", "RB", "WR", "TE"];

  const projections = [];

  for (const position of positions) {
    const projections_position = await axiosInstance.get(
      `https://api.sleeper.com/projections/nfl/${season}/${week}?season_type=${season_type}&position[]=${position}&order_by=ppr`
    );

    projections.push(projections_position.data);
  }

  return projections.flat();
};

const fetchLeagueTransactions = async (league_id, week) => {
  const transactions_week = await axiosInstance.get(
    `https://api.sleeper.app/v1/league/${league_id}/transactions/${week}`
  );

  return transactions_week.data.filter((t) => t.status === "complete");
};

const fetchDraftPicks = async (draft_id) => {
  const draft_picks = await axiosInstance.get(
    `https://api.sleeper.app/v1/draft/${draft_id}/picks`
  );

  return draft_picks.data;
};

module.exports = {
  fetchState,
  fetchAllPlayers,
  fetchUser,
  fetchUserLeagues,
  fetchLeague,
  fetchLeagueRosters,
  fetchLeagueUsers,
  fetchLeagueDrafts,
  fetchLeagueTradedPicks,
  fetchStats,
  fetchProjections,
  fetchLeagueTransactions,
  fetchDraftPicks,
};
