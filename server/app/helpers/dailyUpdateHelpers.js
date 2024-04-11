"use strict";

const { parentPort } = require("worker_threads");
const { fetchState, fetchAllPlayers } = require("../api/sleeperApi");
const fs = require("fs");
const db = require("../models");
const User = db.users;

const getState = async () => {
  const state = await fetchState();

  parentPort.postMessage({
    state: {
      ...state,
      season: process.env.SEASON || state.season,
      league_season: process.env.SEASON || state.league_season,
    },
  });
};

const getAllPlayers = async () => {
  let sleeper_players = await fetchAllPlayers();

  sleeper_players = Object.fromEntries(
    Object.keys(sleeper_players)
      .filter(
        (player_id) =>
          sleeper_players[player_id].active &&
          ["QB", "RB", "FB", "WR", "TE", "K"].includes(
            sleeper_players[player_id].position
          )
      )
      .map((key) => {
        const {
          position,
          fantasy_positions,
          college,
          number,
          birth_date,
          age,
          full_name,
          active,
          team,
          player_id,
          search_full_name,
          years_exp,
        } = sleeper_players[key];
        return [
          key,
          {
            position,
            fantasy_positions,
            college,
            number,
            birth_date,
            age,
            full_name,
            active,
            team,
            player_id,
            search_full_name,
            years_exp,
          },
        ];
      })
  );

  fs.writeFileSync("./data/allplayers.json", JSON.stringify(sleeper_players));
};
const getRecentUsers = async () => {
  const recent = await User.findAndCountAll({
    order: [["updatedAt", "DESC"]],
    attributes: ["username", "updatedAt"],
    where: {
      type: "RS",
    },
    raw: true,
  });

  console.log({ user_count: recent.count });

  fs.writeFileSync("./data/recent_users.json", JSON.stringify(recent));
};

const getMain = async () => {
  await getState();

  await getRecentUsers();

  if (process.env.NODE_ENV === "production") {
    await getAllPlayers();
  }
};

getMain();
