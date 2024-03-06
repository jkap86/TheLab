"use strict";

module.exports = (sequelize, Sequelize) => {
  const Auctionpick = sequelize.define("auctionpick", {
    draftDraftId: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
    player_id: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
    budget_percent: {
      type: Sequelize.INTEGER,
    },
    roster_id: {
      type: Sequelize.INTEGER,
    },
    picked_by: {
      type: Sequelize.STRING,
    },
    league_type: {
      type: Sequelize.STRING,
    },
  });

  return Auctionpick;
};
