"use strict";

const db = require("../models");
const User = db.users;
const League = db.leagues;
const Draft = db.drafts;
const {
  fetchLeagueRosters,
  fetchLeagueUsers,
  fetchLeagueDrafts,
  fetchLeagueTradedPicks,
} = require("../api/sleeperApi");

const splitLeagues = async (leagues, cutoff) => {
  try {
    const leagues_db = await League.findAll({
      where: {
        league_id: leagues.map((league) => league.league_id),
      },
      raw: true,
    });

    const leagues_to_add = leagues.filter(
      (l) => !leagues_db?.find((l_db) => l.league_id === l_db.league_id)
    );

    const leagues_to_update = leagues_db.filter(
      (l) =>
        l.updatedAt < cutoff ||
        (Array.isArray(l.rosters) && l.rosters?.length === 0)
    );

    const leagues_up_to_date = leagues_db.filter(
      (l) => !leagues_to_update.find((l2) => l.league_id === l2.league_id)
    );

    return [leagues_to_add, leagues_to_update, leagues_up_to_date];
  } catch (error) {
    return [leagues, [], []];
  }
};

const updateLeagueRostersUsers = (rosters, users) => {
  let rosters_w_username = [];

  for (const roster of rosters) {
    const user = users.find((u) => u.user_id === roster.owner_id);

    const co_owners = roster.co_owners?.map((co) => {
      const co_user = users.find((u) => u.user_id === co);
      return {
        user_id: co_user?.user_id,
        username: co_user?.display_name,
        avatar: co_user?.avatar,
      };
    });

    rosters_w_username.push({
      taxi: roster.taxi,
      starters: roster.starters,
      settings: roster.settings,
      roster_id: roster.roster_id,
      reserve: roster.reserve,
      players: roster.players,
      user_id: roster.owner_id,
      username: user?.display_name,
      avatar: user?.avatar,
      co_owners,
    });
  }

  return rosters_w_username;
};

const getLeagueDraftPicks = ({ league, rosters, drafts, traded_picks }) => {
  let draft_picks_league = {};

  if (
    league.settings.type === 2 &&
    rosters?.find((r) => r.players?.length > 0)
  ) {
    let draft_season;

    const upcoming_draft = drafts.find(
      (x) =>
        x.status !== "complete" &&
        x.settings.rounds === league.settings.draft_rounds
    );

    if (upcoming_draft) {
      draft_season = parseInt(league.season);
    } else {
      draft_season = parseInt(league.season) + 1;
    }

    const draft_order = upcoming_draft?.draft_order;

    rosters.forEach((roster) => {
      draft_picks_league[roster.roster_id] = [];

      for (let j = draft_season; j <= draft_season + 2; j++) {
        for (let k = 1; k <= league.settings.draft_rounds; k++) {
          const isTraded = traded_picks.find(
            (pick) =>
              parseInt(pick.season) === j &&
              pick.round === k &&
              pick.roster_id === roster.roster_id
          );

          if (!isTraded) {
            draft_picks_league[roster.roster_id].push({
              season: j,
              round: k,
              roster_id: roster.roster_id,
              original_user: {
                avatar: roster.avatar,
                user_id: roster.user_id,
                username: roster.username,
              },
              order: (draft_order && draft_order[roster?.user_id]) || "NA",
            });
          }
        }
      }

      traded_picks
        .filter(
          (x) =>
            x.owner_id === roster.roster_id &&
            parseInt(x.season) >= draft_season
        )
        .forEach((pick) => {
          const original_roster = rosters.find(
            (r) => r.roster_id === pick.roster_id
          );

          draft_picks_league[roster.roster_id].push({
            season: parseInt(pick.season),
            round: pick.round,
            roster_id: pick.roster_id,
            original_user: {
              avatar: original_roster?.avatar,
              user_id: original_roster?.user_id,
              username: original_roster?.username,
            },
            order:
              (draft_order && draft_order[original_roster?.user_id]) || "NA",
          });
        });

      traded_picks
        .filter(
          (x) =>
            x.previous_owner_id === roster.roster_id &&
            parseInt(x.season) >= draft_season
        )
        .forEach((pick) => {
          const index = draft_picks_league[roster.roster_id].findIndex(
            (obj) => {
              return (
                obj.season === pick.season &&
                obj.round === pick.round &&
                obj.roster_id === pick.roster_id
              );
            }
          );

          if (index !== -1) {
            draft_picks_league[roster.roster_id].splice(index, 1);
          }
        });
    });
  }

  return draft_picks_league;
};

const upsertLeagues = async (leagues) => {
  const leagues_to_add = await Promise.all(
    leagues.map(async (league) => {
      try {
        const rosters = await fetchLeagueRosters(league.league_id);
        const users = await fetchLeagueUsers(league.league_id);

        const updated_rosters = updateLeagueRostersUsers(rosters, users);

        const drafts = await fetchLeagueDrafts(league.league_id);

        let draft_picks;

        if (
          league.settings.type === 2 &&
          rosters.find((r) => r.players?.length > 0)
        ) {
          const traded_picks = await fetchLeagueTradedPicks(league.league_id);

          draft_picks = getLeagueDraftPicks({
            league,
            rosters: updated_rosters,
            drafts,
            traded_picks,
          });
        }

        const updated_rosters_draft_picks = updated_rosters.map((roster) => {
          return {
            ...roster,
            draft_picks: draft_picks?.[roster.roster_id] || [],
          };
        });

        return {
          league_id: league.league_id,
          name: league.name,
          avatar: league.avatar,
          season: league.season,
          settings: {
            ...league.settings,
            status: league.status,
          },
          scoring_settings: league.scoring_settings,
          roster_positions: league.roster_positions,
          rosters: updated_rosters_draft_picks,
          drafts: drafts,
          updatedAt: new Date(),
        };
      } catch (err) {
        return {
          error: {
            league_id: league.league_id,
            name: league.name,
          },
        };
      }
    })
  );

  const user_data = [];
  const user_league_data = [];
  const draft_data = [];

  leagues_to_add.forEach((league) => {
    league.rosters
      .filter((roster) => roster.players?.length > 0)
      .forEach((roster) => {
        if (parseInt(roster.user_id) > 0) {
          if (!user_data.find((u) => u.user_id === roster.user_id)) {
            user_data.push({
              user_id: roster.user_id,
              username: roster.username,
              avatar: roster.avatar,
              type: "LM",
            });
          }

          user_league_data.push({
            userUserId: roster.user_id,
            leagueLeagueId: league.league_id,
          });

          roster.co_owners?.forEach((co) => {
            if (!user_data.find((u) => u.user_id === co.user_id)) {
              user_data.push({
                user_id: co.user_id,
                username: co.username,
                avatar: co.avatar,
                type: "LM",
              });
            }

            user_league_data.push({
              userUserId: co.user_id,
              leagueLeagueId: league.league_id,
            });
          });
        }
      });

    league.drafts
      .filter(
        (draft) =>
          !draft.settings.slots_dl &&
          !draft.settings.slots_lb &&
          !draft.settings.slots_db &&
          !draft.settings.slots_idp_flex &&
          !draft.settings.slots_def
      )
      .forEach((draft) => {
        const {
          draft_id,
          type,
          status,
          start_time,
          last_picked,
          settings,
          draft_order,
        } = draft;

        const league_type =
          league.settings.type === 2
            ? "D"
            : league.settings.type === 0
            ? "R"
            : false;

        if (league_type) {
          draft_data.push({
            draft_id,
            type,
            status,
            start_time,
            last_picked,
            league_type,
            settings,
            draft_order,
            leagueLeagueId: league.league_id,
          });
        }
      });
  });

  await User.bulkCreate(user_data, {
    updateOnDuplicate: ["username", "avatar"],
  });

  await League.bulkCreate(
    leagues_to_add.filter((l) => l.league_id),
    {
      updateOnDuplicate: [
        "name",
        "avatar",
        "settings",
        "scoring_settings",
        "roster_positions",
        "rosters",
        "updatedAt",
      ],
    }
  );

  await db.sequelize
    .model("userLeagues")
    .bulkCreate(user_league_data, { ignoreDuplicates: true });

  await Draft.bulkCreate(draft_data, {
    updateOnDuplicate: [
      "type",
      "status",
      "start_time",
      "last_picked",
      "league_type",
      "settings",
      "draft_order",
    ],
  });

  return leagues_to_add;
};

module.exports = {
  splitLeagues,
  upsertLeagues,
};
