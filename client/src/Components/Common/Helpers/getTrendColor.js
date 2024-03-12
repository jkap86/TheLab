const findStandardDeviation = (values) => {
  const mean = values.reduce((acc, val) => acc + val, 0) / values.length;
  const variance =
    values.reduce((acc, val) => acc + (val - mean) ** 2, 0) /
    (values.length - 1);

  return Math.sqrt(variance);
};

export const getTrendColorRank = (stat, min, max) => {
  const median = (max - min) / 2 + min;

  if (stat > median) {
    const x = ((stat - median) / (max - median)) * 255;

    return {
      color: `rgb(${255 - x}, ${255}, ${255 - x})`,
    };
  } else if (stat < median) {
    const x = ((median - stat) / (median - min)) * 255;

    return {
      color: `rgb(${255}, ${255 - x}, ${255 - x})`,
    };
  }
};

export const getTrendColorValue = (stat, values) => {
  const std = findStandardDeviation(values);
  const mean = values.reduce((acc, cur) => acc + cur, 0) / values.length;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;

  if (stat > mean) {
    const x = (max - mean) / std;

    const y = (stat - mean) / std;

    const adj = (255 * y) / x;

    return {
      color: `rgb(${255 - adj}, ${255}, ${255 - adj})`,
    };
  } else if (stat < mean) {
    const x = (mean - min) / std;

    const y = (mean - stat) / std;

    const adj = (255 * y) / x;

    return {
      color: `rgb(${255}, ${255 - adj}, ${255 - adj})`,
    };
  }
};
