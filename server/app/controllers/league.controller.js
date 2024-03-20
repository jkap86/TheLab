"use strict";

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Op = db.Sequelize.Op;
const { fetchUserLeagues, fetchLeague } = require("../api/sleeperApi");
const { upsertLeagues, splitLeagues } = require("../helpers/upsertLeagues");
const { getLeaguemateLeagues } = require("../helpers/leaguemateLeagues");
const JSONStream = require("JSONStream");

exports.upsert = async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Transfer-Encoding", "chunked");

  const stream = JSONStream.stringify();
  stream.pipe(res);

  const leagues = await fetchUserLeagues(req.query.user_id, req.query.season);

  const cutoff = 6 * 60 * 60 * 1000;
  const batchSize = 25;

  for (let i = 0; i < leagues.length; i += batchSize) {
    const batchLeagues = leagues.slice(i, i + batchSize);

    const [leagues_to_add, leagues_to_update, leagues_up_to_date] =
      await splitLeagues(batchLeagues, new Date(new Date() - cutoff));

    const upserted_leagues = await upsertLeagues([
      ...leagues_to_add,
      ...leagues_to_update,
    ]);

    const data = [...leagues_up_to_date, ...upserted_leagues]
      .sort(
        (a, b) =>
          leagues.findIndex((l) => l.league_id === a.league_id) -
          leagues.findIndex((l) => l.league_id === b.league_id)
      )
      .map((league) => {
        const userRoster = league.rosters?.find((roster) => {
          return (
            (roster.user_id === req.query.user_id ||
              roster.co_owners?.find(
                (co) => co?.user_id === req.query.user_id
              )) &&
            (roster.players?.length > 0 ||
              league.settings.status === "drafting")
          );
        });

        return {
          ...league,
          userRoster: userRoster,
        };
      })
      .filter((league) => league.userRoster);

    stream.write(data);
  }
  stream.end();
};

exports.sync = async (req, res) => {
  const league_to_sync = await fetchLeague(req.query.league_id);

  const synced_league = await upsertLeagues([league_to_sync]);

  const userRoster = synced_league[0].rosters?.find((roster) => {
    return (
      (roster.user_id === req.query.user_id ||
        roster.co_owners?.find((co) => co?.user_id === req.query.user_id)) &&
      (roster.players?.length > 0 ||
        synced_league.settings.status === "drafting")
    );
  });

  res.send({
    ...synced_league[0],
    userRoster,
  });
};

exports.leaguemate = async (req, res) => {
  try {
    const leaguemateLeagues = await getLeaguemateLeagues(
      req.query.user_id,
      League,
      User
    );

    res.send(leaguemateLeagues.map((league) => league.dataValues.league_id));
  } catch (err) {
    console.log(err.message);
  }
};
