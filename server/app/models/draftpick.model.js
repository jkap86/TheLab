"use strict";

module.exports = (sequelize, Sequelize) => {
  const Draftpick = sequelize.define("draftpick", {
    draftDraftId: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
    pick_no: {
      type: Sequelize.INTEGER,
      allowNull: false,
      primaryKey: true,
    },
    player_id: {
      type: Sequelize.STRING,
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

  return Draftpick;
};
