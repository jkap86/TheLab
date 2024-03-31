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
    "League ID",
  ];

  if (lm) {
    return [
      ...columnOptionsLeagues,
      ...columnOptionsLeagues
        .filter((colname) => ["Rank"].includes(colname))
        .map((colname) => `LM ${colname}`),
    ];
  } else {
    return columnOptionsLeagues;
  }
};
