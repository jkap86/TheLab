"use strict";

const getLeaguemateLeagues = async (user_id, League, User) => {
  const leaguemateLeagues = await League.findAll({
    attributes: ["league_id"],
    include: {
      model: User,
      through: { attributes: [] },
      attributes: ["user_id"],
      include: {
        model: League,
        through: { attributes: [] },
        attributes: [],
        include: {
          model: User,
          attributes: [],
          through: { attributes: [] },
          where: {
            user_id: user_id,
          },
        },
        required: true,
      },
      required: true,
    },
  });

  return leaguemateLeagues;
};

module.exports = {
  getLeaguemateLeagues: getLeaguemateLeagues,
};
