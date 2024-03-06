const https = require("https");
const axios = require("axios");

const axiosInstance = axios.create({
  headers: {
    "content-type": "application/json",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  },
  httpsAgent: new https.Agent({ keepAlive: true }),
  timeout: 4000,
});

const axiosRetry = require("axios-retry").default;

try {
  axiosRetry(axiosInstance, {
    retries: 3,
    retryCondition: (error) => {
      return error.response
        ? axiosRetry.isRetryableError(error) || error.response.status >= 500
        : true;
    },
    retryDelay: (retryNumber) => {
      return 500 + retryNumber * 500;
    },
  });
} catch (error) {
  console.log(error);
}

module.exports = axiosInstance;
