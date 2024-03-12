"use strict";

const { parentPort } = require("worker_threads");
const { fetchState, fetchAllPlayers } = require("../api/sleeperApi");
const fs = require("fs");

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

const getMain = async () => {
  await getState();

  if (process.env.NODE_ENV === "production") {
    await getAllPlayers();
  }
};

getMain();
