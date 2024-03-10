"use strict";

const db = require("../models");
const League = db.leagues;
const Draft = db.drafts;
const Draftpick = db.draftpicks;
const Auctionpick = db.auctionpicks;
const sequelize = db.sequelize;
const Op = db.Sequelize.Op;

exports.adp = async (req, res) => {
  try {
    let draft_picks = await Draftpick.findAll({
      attributes: [
        "player_id",
        "league_type",
        [sequelize.fn("AVG", sequelize.col("pick_no")), "adp"],
        [sequelize.fn("COUNT", sequelize.col("draft.draft_id")), "n_drafts"],
      ],
      include: {
        model: Draft,
        attributes: [],
        where: {
          start_time: {
            [Op.gt]: new Date(new Date() - 30 * 24 * 60 * 60 * 1000).getTime(),
          },
        },
        include: {
          model: League,
          attributes: [],
          where: {
            league_id: req.body.league_ids,
          },
        },
      },
      group: ["player_id", "draftpick.league_type"],
    });

    if (draft_picks.length < 500) {
      draft_picks = await Draftpick.findAll({
        attributes: [
          "player_id",
          "league_type",
          [sequelize.fn("AVG", sequelize.col("pick_no")), "adp"],
          [sequelize.fn("COUNT", sequelize.col("draft.draft_id")), "n_drafts"],
        ],
        include: {
          model: Draft,
          attributes: [],
          where: {
            start_time: {
              [Op.gt]: new Date(
                new Date() - 30 * 24 * 60 * 60 * 1000
              ).getTime(),
            },
          },
        },
        group: ["player_id", "draftpick.league_type"],
      });
    }

    let auction_picks = await Auctionpick.findAll({
      attributes: [
        "player_id",
        "league_type",
        [sequelize.fn("AVG", sequelize.col("budget_percent")), "adp"],
        [sequelize.fn("COUNT", sequelize.col("draft.draft_id")), "n_drafts"],
      ],
      include: {
        model: Draft,
        attributes: [],
        where: {
          start_time: {
            [Op.gt]: new Date(new Date() - 30 * 24 * 60 * 60 * 1000).getTime(),
          },
        },
        include: {
          model: League,
          attributes: [],
          where: {
            league_id: req.body.league_ids,
          },
        },
      },
      group: ["player_id", "auctionpick.league_type"],
    });

    if (auction_picks.length < 500) {
      auction_picks = await Auctionpick.findAll({
        attributes: [
          "player_id",
          "league_type",
          [sequelize.fn("AVG", sequelize.col("budget_percent")), "adp"],
          [sequelize.fn("COUNT", sequelize.col("draft.draft_id")), "n_drafts"],
        ],
        include: {
          model: Draft,
          attributes: [],
          where: {
            start_time: {
              [Op.gt]: new Date(
                new Date() - 30 * 24 * 60 * 60 * 1000
              ).getTime(),
            },
          },
        },
        group: ["player_id", "auctionpick.league_type"],
      });
    }

    res.send({ draft_picks, auction_picks });
  } catch (err) {
    console.log(err.message);
  }
};
