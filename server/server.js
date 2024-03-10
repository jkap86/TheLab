"use strict";

const throng = require("throng");
const WORKERS = process.env.WEB_CONCURRENCY || 1;

const start = () => {
  const express = require("express");
  const cors = require("cors");
  const compression = require("compression");
  const path = require("path");

  const app = express();

  app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

  // MIDDLEWARE

  app.use(compression());
  app.use(cors());
  app.use(express.json({ limit: "50mb" }));
  app.use(express.static(path.resolve(__dirname, "../client/build")));

  // INITIALIZE DATABASE

  const db = require("./app/models");
  db.sequelize
    .sync()
    .then(() => {
      console.log("Synced db.");
    })
    .catch((err) => {
      console.log("Failed to sync db: " + err.message);
    });

  // ROUTES

  require("./app/routes/common.routes")(app);
  require("./app/routes/user.routes")(app);
  require("./app/routes/league.routes")(app);
  require("./app/routes/draft.routes")(app);

  app.get("*", async (req, res) => {
    res.sendFile(path.join(__dirname, "../client/build/index.html"));
  });

  // CLOSE DATABASE CONNECTION ON SHUTDOWN

  process.on("SIGINT", () => {
    console.log("Server is shutting down.");

    db.sequelize
      .close()
      .then(() => {
        console.log("Database connections have been closed.");
        process.exit(0);
      })
      .catch((err) => {
        console.error("Error closing database connections:", err);
        process.exit(1);
      });
  });

  // START SERVER

  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}.`);

    // BACKGROUND

    require("./app/background/dailyUpdate")(app);
  });
};

throng({
  worker: start,
  count: WORKERS,
});
