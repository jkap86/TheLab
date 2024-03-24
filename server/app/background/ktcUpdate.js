"use strict";

const { Worker } = require("worker_threads");
const path = require("path");

module.exports = async (app) => {
  const startKtcWorker = () => {
    console.log("KTC update starting...");

    const worker = new Worker(
      path.resolve(__dirname, "../helpers/ktcValuesHelper.js")
    );

    //worker.on("message", (message) => app.set("state", message.state));
    worker.on("error", (error) => console.error(error));
    worker.on("exit", (code) => {
      if (code === 0) {
        console.log("KTC update complete...");
      } else {
        console.error(`Worker stopped with exit code ${code}`);
      }
    });
  };

  setTimeout(() => {
    startKtcWorker();

    setInterval(startKtcWorker, 1 * 60 * 60 * 1000);
  }, 5000);
};
