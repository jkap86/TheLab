"use strict";

const db = require("../models");
const Trade = db.trades;
const League = db.leagues;
const Op = db.Sequelize.Op;

exports.leaguemate = async (req, res) => {
  let filters = [];

  if (req.body.manager) {
    filters.push({
      managers: {
        [Op.contains]: [req.body.manager],
      },
    });
  }

  if (req.body.player) {
    if (req.body.player.includes(".")) {
      const pick_split = req.body.player.split(" ");
      const season = pick_split[0];
      const round = parseInt(pick_split[1]?.split(".")[0]);
      const order =
        parseInt(season) === parseInt(new Date().getFullYear())
          ? parseInt(pick_split[1]?.split(".")[1])
          : null;

      filters.push({
        players: {
          [Op.contains]: [`${season} ${round}.${order}`],
        },
      });
    } else {
      filters.push({
        players: {
          [Op.contains]: [req.body.player],
        },
      });
    }
  }

  try {
    const leaguemateTrades = await Trade.findAndCountAll({
      order: [["status_updated", "DESC"]],
      offset: req.body.offset,
      limit: req.body.limit,
      where: { [Op.and]: filters },
      attributes: [
        "transaction_id",
        "status_updated",
        "rosters",
        "adds",
        "drops",
        "draft_picks",
        "leagueLeagueId",
      ],
      include: {
        model: League,
        attributes: [
          "league_id",
          "name",
          "avatar",
          "roster_positions",
          "scoring_settings",
          "settings",
        ],
        where: {
          league_id: req.body.league_ids,
        },
      },
      raw: true,
    });

    res.send(leaguemateTrades);
  } catch (error) {
    res.send(error);
    console.log(error);
  }
};

exports.pricecheck = async (req, res) => {
  let filters = [];

  if (req.query.player.includes(".")) {
    const pick_split = req.query.player.split(" ");
    const season = pick_split[0];
    const round = parseInt(pick_split[1]?.split(".")[0]);
    const order = parseInt(pick_split[1]?.split(".")[1]);

    filters.push({
      price_check: {
        [Op.contains]: [`${season} ${round}.${order}`],
      },
    });
  } else {
    filters.push({
      price_check: {
        [Op.contains]: [req.query.player],
      },
    });
  }

  if (req.query.player2) {
    if (req.query.player2.includes(".")) {
      const pick_split = req.query.player2.split(" ");
      const season = pick_split[0];
      const round = parseInt(pick_split[1]?.split(".")[0]);
      const order = parseInt(pick_split[1]?.split(".")[1]);

      filters.push({
        players: {
          [Op.contains]: [`${season} ${round}.${order}`],
        },
      });
    } else {
      filters.push({
        players: {
          [Op.contains]: [req.query.player2],
        },
      });
    }
  }

  let pcTrades;
  let players2;

  try {
    pcTrades = await Trade.findAndCountAll({
      order: [["status_updated", "DESC"]],
      offset: req.query.offset,
      limit: req.query.limit,
      where: {
        [Op.and]: filters,
      },
      attributes: [
        "transaction_id",
        "status_updated",
        "rosters",
        "managers",
        "adds",
        "drops",
        "draft_picks",
        "leagueLeagueId",
      ],
      include: {
        model: League,
        attributes: [
          "name",
          "avatar",
          "scoring_settings",
          "roster_positions",
          "settings",
        ],
      },
      raw: true,
    });
  } catch (error) {
    console.log(error);
  }

  res.send(pcTrades);
};
