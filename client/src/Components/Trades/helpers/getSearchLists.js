export const getPicksList = (league_season) => {
  const picks_list = [];

  Array.from(Array(4).keys()).forEach((season) => {
    Array.from(Array(5).keys()).forEach((round) => {
      if (season !== 0) {
        return picks_list.push({
          id: `${season + parseInt(league_season)} ${round + 1}.${null}`,
          text: `${season + parseInt(league_season)}  Round ${round + 1}`,
          image: {
            src: null,
            alt: "pick headshot",
            type: "player",
          },
        });
      } else {
        Array.from(Array(12).keys()).forEach((order) => {
          return picks_list.push({
            id: `${season + parseInt(league_season)} ${round + 1}.${
              season === 0
                ? (order + 1).toLocaleString("en-US", {
                    minimumIntegerDigits: 2,
                  })
                : null
            }`,
            text: `${season + parseInt(league_season)} ${
              season === 0
                ? `${round + 1}.${(order + 1).toLocaleString("en-US", {
                    minimumIntegerDigits: 2,
                  })}`
                : ` Round ${round + 1}`
            }`,
            image: {
              src: null,
              alt: "pick headshot",
              type: "player",
            },
          });
        });
      }
    });
  });
};

export const getPlayersList = (leagues, allplayers, picks_list) => {
  return (
    (leagues && [
      ...Array.from(
        new Set(
          leagues
            ?.map((league) => league.rosters?.map((roster) => roster.players))
            .flat(3)
        )
      ).map((player_id) => {
        return {
          id: player_id,
          text: allplayers[player_id]?.full_name,
          image: {
            src: player_id,
            alt: "player headshot",
            type: "player",
          },
        };
      }),
      ...(picks_list || []),
    ]) ||
    []
  );
};

export const getManagersList = (leagues) => {
  const managers = {};

  (leagues || []).forEach((league) => {
    league.rosters.forEach((roster) => {
      if (parseInt(roster.user_id) > 0) {
        managers[roster.user_id] = {
          id: roster.user_id,
          text: roster.username,
          image: {
            src: roster.avatar,
            alt: "user avatar",
            type: "user",
          },
        };
      }
    });
  });

  return Object.values(managers);
};
