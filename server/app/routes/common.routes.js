"use strict";

const fs = require("fs");
const path = require("path");

module.exports = (app) => {
  var router = require("express").Router();

  router.get("/state", (req, res) => {
    const data = app.get("state");

    res.send(data);
  });

  router.get("/allplayers", (req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Transfer-Encoding", "chunked");

    const allplayers = path.join(__dirname, "../../data/allplayers.json");

    try {
      const data = fs.readFileSync(allplayers, "utf8");

      res.send(data);
    } catch (err) {
      console.log(err.message);
    }
  });

  app.use("/common", router);
};
