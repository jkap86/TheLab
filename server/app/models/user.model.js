"use strict";

module.exports = (sequelize, Sequelize) => {
  const User = sequelize.define("user", {
    user_id: {
      type: Sequelize.STRING,
      allowNull: false,
      primaryKey: true,
    },
    username: {
      type: Sequelize.STRING,
    },
    avatar: {
      type: Sequelize.STRING,
    },
    type: {
      type: Sequelize.STRING,
    },
    playershares: {
      type: Sequelize.JSONB,
    },
    playershares_update: {
      type: Sequelize.DATE,
    },
  });

  return User;
};
