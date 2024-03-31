import TableMain from "../../Common/TableMain";
import LoadingIcon from "../../Common/LoadingIcon";
import { useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setStateLeaguemates } from "../redux/actions";
import { filterLeagues } from "../../Common/services/helpers/filterLeagues";

const LeaguematePlayers = ({ leaguemate }) => {
  const dispatch = useDispatch();
  const { allplayers } = useSelector((state) => state.common);
  const {
    username,
    leagues,
    type1,
    type2,
    lmplayershares,
    userPlayerShares,
    isLoadingPS,
  } = useSelector((state) => state.user);
  const {
    page_players_c,
    page_players_a,
    itemActive_players,
    searched_players,
    sortBy,
    secondaryContent,
  } = useSelector((state) => state.leaguemates);

  const playershares_lm =
    (lmplayershares || [])?.find((lmps) => lmps.user_id === leaguemate.user_id)
      ?.playershares || {};
  console.log({ lmplayershares, userPlayerShares });

  let keys;

  switch (`${type1}-${type2}`) {
    case "All-All":
      keys = ["all"];
      break;
    case "Redraft-All":
      keys = ["r_b", "r_s"];

      break;
    case "Dynasty-All":
      keys = ["d_b", "d_s"];

      break;
    case "All-Bestball":
      keys = ["r_b", "d_b"];

      break;
    case "All-Standard":
      keys = ["r_s", "d_s"];

      break;
    default:
      break;
  }

  const playersCount = useMemo(() => {
    const players_all = [];

    filterLeagues(leaguemate.leagues, type1, type2).map((league) => {
      return (
        league.lmRoster.players.map((player) => {
          return players_all.push({
            id: player,
            league: league,
            type: "lm",
            wins: league.lmRoster.settings.wins,
            losses: league.lmRoster.settings.losses,
            ties: league.lmRoster.settings.ties,
          });
        }) &&
        league.userRoster.players.map((player) => {
          return players_all.push({
            id: player,
            league: league,
            type: "user",
            wins: league.userRoster.settings.wins,
            losses: league.userRoster.settings.losses,
            ties: league.userRoster.settings.ties,
          });
        })
      );
    });

    const players_count = [];

    players_all.forEach((player) => {
      const index = players_count.findIndex((obj) => {
        return obj.id === player.id;
      });
      if (index === -1) {
        let leagues_lm = players_all.filter(
          (x) => x.id === player.id && x.type === "lm"
        );
        let leagues_user = players_all.filter(
          (x) => x.id === player.id && x.type === "user"
        );

        const lm_record = leagues_lm.reduce(
          (acc, cur) => {
            return {
              wins: acc.wins + cur.wins,
              losses: acc.losses + cur.losses,
              ties: acc.ties + cur.ties,
            };
          },
          {
            wins: 0,
            losses: 0,
            ties: 0,
          }
        );

        const user_record = leagues_user.reduce(
          (acc, cur) => {
            return {
              wins: acc.wins + cur.wins,
              losses: acc.losses + cur.losses,
              ties: acc.ties + cur.ties,
            };
          },
          {
            wins: 0,
            losses: 0,
            ties: 0,
          }
        );

        players_count.push({
          id: player.id,
          leagues_lm: leagues_lm,
          lm_record: lm_record,
          leagues_user: leagues_user,
          user_record: user_record,
        });
      }
    });

    return players_count;
  }, [leaguemate, type1, type2]);

  const leaguematePlayers_headers = [
    [
      {
        text: "Player",
        colSpan: 4,
        rowSpan: 2,
        className: "half",
      },
      {
        text: leaguemate.username,
        colSpan: 4,
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
        className: "half",
      },
      {
        text: username,
        colSpan: 4,
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
        className: "half",
      },
    ],
    [
      {
        text: "Count",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
      },
      {
        text: "Record",
        colSpan: 3,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
      },
      {
        text: "Count",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
      },
      {
        text: "Record",
        colSpan: 3,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
      },
    ],
  ];

  const leaguematePlayers_body = playersCount
    .filter(
      (player) => !searched_players.id || player.id === searched_players.id
    )
    .sort((a, b) =>
      sortBy === "Leaguemate"
        ? b.leagues_lm?.length - a.leagues_lm?.length
        : b.leagues_user?.length - a.leagues_user?.length
    )
    .map((player) => {
      const lm_wins = player.lm_record.wins;
      const lm_losses = player.lm_record.losses;
      const lm_ties = player.lm_record.ties;

      const user_wins = player.user_record.wins;
      const user_losses = player.user_record.losses;
      const user_ties = player.user_record.ties;

      return {
        id: player.id,
        search: {
          text: allplayers[player.id]?.full_name,
          image: {
            src: player.id,
            alt: "player headshot",
            type: "player",
          },
        },
        list: [
          {
            text: allplayers[player.id]?.full_name,
            colSpan: 4,
            className: "left",
            image: {
              src: player.id,
              alt: "player headshot",
              type: "player",
            },
          },
          {
            text: (allplayers[player.id] && player.leagues_lm.length) || "0",
            colSpan: 1,
          },
          {
            text:
              allplayers[player.id] &&
              lm_wins + "-" + lm_losses + (lm_ties > 0 ? `-${lm_ties}` : ""),
            colSpan: 3,
          },
          {
            text: (allplayers[player.id] && player.leagues_user.length) || "0",
            colSpan: 1,
          },
          {
            text:
              allplayers[player.id] &&
              user_wins +
                "-" +
                user_losses +
                (user_ties > 0 ? `-${user_ties}` : ""),
            colSpan: 3,
          },
        ],
        secondary_table: "",
      };
    });

  const leaguematePlayersAll_headers = [
    [
      {
        text: "Player",
        colSpan: 3,
        rowSpan: 2,
        className: "half",
      },
      {
        text: leaguemate.username,
        colSpan: 2,
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
        className: "half",
      },
      {
        text: username,
        colSpan: 2,
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
        className: "half",
      },
    ],
    [
      {
        text: "Count",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
      },
      {
        text: "Record",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "Leaguemate" })),
      },
      {
        text: "Count",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
      },
      {
        text: "Record",
        colSpan: 1,
        className: "small half",
        onClick: () => dispatch(setStateLeaguemates({ sortBy: "User" })),
      },
    ],
  ];

  const leaguematePlayersAll_body = Object.keys(allplayers)
    .filter(
      (player_id) =>
        allplayers[player_id]?.full_name &&
        (!searched_players.id || player_id === searched_players.id)
    )
    .sort((a, b) =>
      sortBy === "Leaguemate"
        ? keys?.reduce(
            (acc, cur) => acc + (playershares_lm?.[b]?.[cur]?.[0] || 0),
            0
          ) -
          keys?.reduce(
            (acc, cur) => acc + (playershares_lm?.[a]?.[cur]?.[0] || 0),
            0
          )
        : (filterLeagues(
            userPlayerShares.find((ups) => ups.id === b)?.leagues_owned || [],
            type1,
            type2
          )?.length || "0") -
          (filterLeagues(
            userPlayerShares.find((ups) => ups.id === a)?.leagues_owned || [],
            type1,
            type2
          )?.length || "0")
    )
    .map((player_id) => {
      return {
        id: player_id,
        search: {
          text: allplayers[player_id]?.full_name,
          image: {
            src: player_id,
            alt: "player headshot",
            type: "player",
          },
        },
        list: [
          {
            text: allplayers[player_id]?.full_name || "-",
            colSpan: 3,
            className: "left",
            image: {
              src: player_id,
              alt: "player",
              type: "player",
            },
          },
          {
            text:
              keys?.reduce(
                (acc, cur) =>
                  acc + (playershares_lm?.[player_id]?.[cur]?.[0] || 0),
                0
              ) || "0",
            colSpan: 1,
          },
          {
            text:
              keys?.reduce(
                (acc, cur) =>
                  acc + (playershares_lm?.[player_id]?.[cur]?.[1] || 0),
                0
              ) > 0
                ? (
                    (keys?.reduce(
                      (acc, cur) =>
                        acc + (playershares_lm?.[player_id]?.[cur]?.[0] || 0),
                      0
                    ) /
                      keys?.reduce(
                        (acc, cur) =>
                          acc + (playershares_lm?.[player_id]?.[cur]?.[1] || 0),
                        0
                      )) *
                    100
                  ).toFixed(1)
                : "-",
            colSpan: 1,
          },
          {
            text:
              filterLeagues(
                userPlayerShares.find((ups) => ups.id === player_id)
                  ?.leagues_owned || [],
                type1,
                type2
              )?.length || "0",
            colSpan: 1,
          },
          {
            text:
              filterLeagues(
                userPlayerShares.find((ups) => ups.id === player_id)
                  ?.leagues_owned || [],
                type1,
                type2
              )?.length > 0
                ? (
                    (filterLeagues(
                      userPlayerShares.find((ups) => ups.id === player_id)
                        ?.leagues_owned || [],
                      type1,
                      type2
                    )?.length /
                      filterLeagues(leagues, type1, type2)?.length) *
                    100
                  ).toFixed(1)
                : "-",
            colSpan: 1,
          },
        ],
      };
    });

  return secondaryContent === "Players-all" && isLoadingPS ? (
    <LoadingIcon />
  ) : (
    <TableMain
      id={"Players"}
      type={"secondary"}
      headers={
        secondaryContent === "Players-all"
          ? leaguematePlayersAll_headers
          : leaguematePlayers_headers
      }
      body={
        secondaryContent === "Players-all"
          ? leaguematePlayersAll_body
          : leaguematePlayers_body
      }
      page={
        secondaryContent === "Players-all" ? page_players_a : page_players_c
      }
      setPage={(page) =>
        secondaryContent === "Players-all"
          ? dispatch(setStateLeaguemates({ page_players_a: page }))
          : dispatch(setStateLeaguemates({ page_players_c: page }))
      }
      // itemActive={itemActive_players}
      // setItemActive={(itemActive) => dispatch(setStateLeaguemates({ itemActive_players: itemActive }))}
    />
  );
};

export default LeaguematePlayers;
