import axios, { AxiosInstance, AxiosError } from "axios";
export type { AxiosError, AxiosInstance };
import axiosRetry from "axios-retry";

/**
 * Default axios instance: 30s timeout, 3 retries with exponential-ish
 * backoff, retries on network errors and idempotent 5xx.
 */
const axiosInstance: AxiosInstance = axios.create({
  headers: { "Content-Type": "application/json" },
  timeout: 30_000,
});

axiosRetry(axiosInstance, {
  retries: 3,
  retryDelay: (retryCount) => 3000 + retryCount * 2000,
  // Give each retry the full timeout instead of the time left over from earlier
  // attempts; otherwise a slow first attempt leaves retries a tiny budget and
  // they fail instantly (seen as "timeout of 1038ms exceeded").
  shouldResetTimeout: true,
  retryCondition: (error) =>
    axiosRetry.isNetworkOrIdempotentRequestError(error),
});

export default axiosInstance;
