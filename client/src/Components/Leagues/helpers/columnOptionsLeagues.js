export const getColumnOptionsLeagues = (lm = false) => {
  const columnOptionsLeagues = [
    "Rank D Picks",
    "Rank D Players",
    "Rank D",
    "Rank D Starters",
    "Rank D Bench",
    "Rank R",
    "Rank R Starters",
    "Rank R Bench",
    "Rank D KTC",
    "Rank D Starters KTC",
    "Rank D Bench KTC",
    "Rank D Picks KTC",
    "League ID",
  ];

  if (lm) {
    return [
      ...columnOptionsLeagues,
      ...columnOptionsLeagues
        .filter((colname) => colname.includes("Rank"))
        .map((colname) => `LM ${colname}`),
    ];
  } else {
    return columnOptionsLeagues;
  }
};
