"use strict";

const { query } = require("express-validator");

module.exports = (app) => {
  const router = require("express").Router();

  const users = require("../controllers/user.controller");

  router.get(
    "/upsert",
    [
      query("username")
        .trim()
        .escape()
        .isLength({ min: 3 })
        .withMessage("Username too short")
        .isLength({ max: 30 })
        .withMessage("Username too long"),
    ],
    users.upsert
  );

  app.use("/user", router);
};
