"use strict";

const axiosInstance = require("./axiosInstance");

const fetchKtcHistory = async () => {
  const ktc = await axiosInstance.post(
    "https://keeptradecut.com/dynasty-rankings/histories"
  );

  return ktc.data;
};

module.exports = {
  fetchKtcHistory,
};
