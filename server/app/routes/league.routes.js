"use strict";

const { query } = require("express-validator");

module.exports = (app) => {
  const router = require("express").Router();

  const league = require("../controllers/league.controller");

  router.get(
    "/upsert",
    [
      query("user_id")
        .trim()
        .escape()
        .notEmpty()
        .withMessage("User ID is required"),
      query("season")
        .trim()
        .escape()
        .isLength({ min: 4, max: 4 })
        .withMessage("Invalid Season"),
    ],
    league.upsert
  );

  router.get("/leaguemate", [], league.leaguemate);

  app.use("/league", router);
};
