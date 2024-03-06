"use strict";

const { DataTypes } = require("sequelize");

module.exports = (sequelize, Sequelize) => {
  const Draft = sequelize.define("draft", {
    draft_id: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
    type: {
      type: Sequelize.STRING,
    },
    status: {
      type: Sequelize.STRING,
    },
    start_time: {
      type: DataTypes.BIGINT,
    },
    last_picked: {
      type: DataTypes.BIGINT,
    },
    league_type: {
      type: Sequelize.STRING,
    },
    settings: {
      type: Sequelize.JSONB,
    },
    draft_order: {
      type: Sequelize.JSONB,
    },
  });

  return Draft;
};
