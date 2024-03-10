export const getTrendColor = (stat, range) => {
  return stat > range / 2
    ? {
        color: `rgb(${
          255 - (Math.abs(range / 2 - stat) / (stat / 2)) * 255
        }, 255, ${255 - (Math.abs(range / 2 - stat) / (stat / 2)) * 255})`,
      }
    : stat < range / 2
    ? {
        color: `rgb(255, ${
          255 - (Math.abs(range / 2 - stat) / (stat / 2)) * 255
        }, ${255 - (Math.abs(range / 2 - stat) / (stat / 2)) * 255})`,
      }
    : {};
};
