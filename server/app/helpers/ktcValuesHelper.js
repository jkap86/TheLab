"use strict";

const { parentPort } = require("worker_threads");
const fs = require("fs");
const { fetchKtcHistory } = require("../api/ktcValues");
const { chromium } = require("playwright");
const cheerio = require("cheerio");
const allplayers = require("../../data/allplayers.json");
const ktc_players = require("../../data/ktc_3_24_24.json");
const ktc_sleeper_id_map = require("../../data/ktc_sleeper_id_map.json");

const updateKtcValues = async () => {
  const ktc_json = fs.readFileSync("./data/ktcValues.json", "utf-8");

  const ktcHistory = await fetchKtcHistory();

  const ktcHistoryObject = JSON.parse(ktc_json);

  ktcHistory.forEach((player) => {
    const player_id = ktc_sleeper_id_map[player.playerID];

    [player.oneQB.valueHistory, player.superflex.valueHistory].forEach(
      (valueTypeArray, index) => {
        valueTypeArray.forEach((player_date) => {
          const utcDate = new Date(player_date.d).toISOString().split("T")[0];

          if (!ktcHistoryObject[utcDate]) {
            ktcHistoryObject[utcDate] = {};
          }

          if (!ktcHistoryObject[utcDate][player_id]) {
            ktcHistoryObject[utcDate][player_id] = {};
          }

          ktcHistoryObject[utcDate][player_id][
            index === 0 ? "oneQB" : "superflex"
          ] = player_date.v;
        });
      }
    );
  });

  fs.writeFileSync("./data/ktcValues.json", JSON.stringify(ktcHistoryObject));
};

if (process.env.NODE_ENV === "production") {
  updateKtcValues();
}

const scrapeKTC = async () => {
  const browser = await chromium.launch();

  const page = await browser.newPage();

  const values = [];

  for await (const key of Array.from(Array(10).keys())) {
    try {
      await page.goto(
        `https://keeptradecut.com/dynasty-rankings?page=${key}filters=QB|WR|RB|TE|RDP&format=2`,
        {
          waitUntil: "domcontentloaded",
        }
      );

      const html = await page.content();

      const $ = cheerio.load(html);

      const players = $("div.onePlayer");

      players.each((index, element) => {
        const player = $(element);

        const name_link = player.find(
          ".single-ranking-wrapper div.single-ranking div.player-name p a"
        );

        const name = name_link.text();
        const link = name_link.attr("href");

        const team = player
          .find(
            ".single-ranking-wrapper div.single-ranking div.player-name p span.player-team"
          )
          .text();

        const position = player
          .find(
            ".single-ranking-wrapper div.single-ranking div.position-team p.position"
          )
          .text()
          .slice(0, 2);

        const value = player
          .find(".single-ranking-wrapper div.single-ranking div.value p")
          .text();

        values.push({
          name,
          link,
          position,
          team,
          value,
        });
      });
    } catch (err) {
      console.log({ err });
    }
    console.log(values.length);
  }

  fs.writeFileSync("./data/ktc_3_24_24.json", JSON.stringify(values));

  await browser.close();
};

// scrapeKTC();

const formatName = (name) => {
  return name
    .replace("Jr", "")
    .replace("III", "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
};

const matchKtcWithSleeper = (ktc_players) => {
  const players = [];

  const not_matched = [];

  ktc_players.forEach((ktc_player) => {
    let player_id = Object.keys(allplayers).find((player_id) => {
      return (
        formatName(allplayers[player_id].full_name) ===
          formatName(ktc_player.name) &&
        allplayers[player_id].position === ktc_player.position
      );
    });

    if (!player_id) {
      player_id = Object.keys(allplayers).find((player_id) => {
        const name_array = allplayers[player_id].full_name.split(" ");
        const last_name = name_array[name_array.length - 1];

        return (
          formatName(ktc_player.name).includes(formatName(last_name)) &&
          formatName(ktc_player.name).startsWith(
            formatName(allplayers[player_id].full_name.slice(0, 3))
          ) &&
          allplayers[player_id].position === ktc_player.position
        );
      });
    }

    if (player_id) {
      players.push({
        ...ktc_player,
        player_id: player_id,
        full_name: allplayers[player_id].full_name,
        team_sleeper: allplayers[player_id].team,
      });
    } else {
      not_matched.push(ktc_player.name);
    }
  });

  //  const data = { matched: players, not_matched: not_matched };

  const data = Object.fromEntries(
    players.map((player) => [
      player.link.split("-")[player.link.split("-").length - 1],
      player.player_id,
    ])
  );

  fs.writeFileSync("./data/ktc_sleeper_id_map.json", JSON.stringify(data));
};

//matchKtcWithSleeper(ktc_players);
