export const getAdpFormatted = (adp) => {
  if (adp === 999) {
    return "999";
  } else {
    return `${parseFloat(Math.ceil(adp / 12))}.${(
      (Math.floor(adp) % 12) +
      1
    ).toLocaleString("en-US", { minimumIntegerDigits: 2 })}`;
  }
};
