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

  router.get("/ktcvalues", async (req, res) => {
    const ktc = path.join(__dirname, "../../data/ktcValues.json");

    let data, date;
    try {
      data = fs.readFileSync(ktc, "utf8");

      date = Object.keys(JSON.parse(data)).sort(
        (a, b) => new Date(b) - new Date(a)
      )[0];

      console.log({ date });
    } catch (err) {
      console.log(err.message);
    }

    res.send(JSON.parse(data)[date]);
  });

  app.use("/common", router);
};
