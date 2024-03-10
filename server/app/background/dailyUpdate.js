"use strict";

const { Worker } = require("worker_threads");
const path = require("path");

module.exports = async (app) => {
  setTimeout(() => {
    console.log(
      `Daily update starting at ${new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
      })} ...`
    );

    const worker = new Worker(
      path.resolve(__dirname, "../helpers/dailyUpdateHelpers.js")
    );

    worker.on("message", (message) => app.set("state", message.state));
    worker.on("error", (error) => console.error(error));
    worker.on("exit", (code) => {
      if (code === 0) {
        console.log(
          `Daily update completed at ${new Date().toLocaleString("en-US", {
            timeZone: "America/New_York",
          })} ...`
        );
      } else {
        console.error(`Worker stopped with exit code ${code}`);
      }
    });
  }, 1000);

  const now = new Date();
  const utc = now.setHours(9, 0, 0, 0);
  const delay = now - utc;

  setTimeout(() => {
    setInterval(async () => {
      console.log("Daily update starting...");

      const worker = new Worker(
        path.resolve(__dirname, "../helpers/dailyUpdateHelpers.js")
      );

      worker.on("message", (message) => app.set("state", message.state));
      worker.on("error", (error) => console.error(error));
      worker.on("exit", (code) => {
        if (code === 0) {
          console.log("Daily update complete...");
        } else {
          console.error(`Worker stopped with exit code ${code}`);
        }
      });
    }, 24 * 60 * 60 * 1 * 1000);
  }, delay);
};
