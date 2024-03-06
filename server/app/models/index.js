"use strict";

const dbConfig = require("./db.config");

const Sequelize = require("sequelize");

const ssl = process.env.DATABASE_URL ? { rejectUnauthorized: false } : false;

const sequelize = new Sequelize(dbConfig.DATABASE_URL, {
  dialect: "postgres",
  dialectOptions: { ssl: ssl, useUTC: false },
  logging: false,
  pool: {
    max: 30,
    min: 0,
    acquire: 10000,
    idle: 10000,
  },
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;


db.users = require("./user.model.js")(sequelize, Sequelize);
db.leagues = require("./league.model.js")(sequelize, Sequelize);
db.trades = require("./trade.model.js")(sequelize, Sequelize);
db.drafts = require("./draft.model.js")(sequelize, Sequelize);
db.draftpicks = require("./draftpick.model.js")(sequelize, Sequelize);
db.auctionpicks = require("./auctionpick.model.js")(sequelize, Sequelize);

db.users.belongsToMany(db.leagues, { through: { model: "userLeagues" } });
db.leagues.belongsToMany(db.users, { through: { model: "userLeagues" } });

db.leagues.hasMany(db.trades);
db.trades.belongsTo(db.leagues);

db.leagues.hasMany(db.drafts);
db.drafts.belongsTo(db.leagues);

db.drafts.hasMany(db.draftpicks);
db.draftpicks.belongsTo(db.drafts);

db.drafts.hasMany(db.auctionpicks);
db.auctionpicks.belongsTo(db.drafts);

module.exports = db;
