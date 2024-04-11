import axios from "axios";
import { saveToDB } from "../Helpers/indexedDb";

export const resetState = () => ({
  type: "RESET_STATE",
});

export const setStateUser = (state_obj) => ({
  type: `SET_STATE_USER`,
  payload: state_obj,
});

export const setStateCommon = (state_obj) => ({
  type: `SET_STATE_COMMON`,
  payload: state_obj,
});

export const setStateStandings = (state_obj) => ({
  type: "SET_STATE_STANDINGS",
  payload: state_obj,
});

export const fetchCommon = (item) => {
  return async (dispatch) => {
    dispatch({ type: "FETCH_COMMON_START", payload: { item: item } });

    try {
      const main = await axios.get(`/common/${item}`);

      const data = Array.isArray(main.data) ? main.data[0] : main.data;

      dispatch({
        type: "FETCH_COMMON_SUCCESS",
        payload: {
          item: item,
          data: data,
        },
      });

      if (item === "allplayers") {
        saveToDB("COMMON", item, {
          timestamp: new Date().getTime() + 60 * 60 * 10000,
          data: data,
        });
      }
    } catch (error) {
      dispatch({ type: "FETCH_COMMON_FAILURE", payload: error.message });

      console.error(error.message);
    }
  };
};

export const fetchUser = (username) => {
  return async (dispatch) => {
    dispatch({ type: "FETCH_USER_START" });

    try {
      const user = await axios.get("/user/upsert", {
        params: { username: username },
      });

      if (!user.data?.error) {
        dispatch({ type: "FETCH_USER_SUCCESS", payload: user.data.user });
      } else {
        dispatch({ type: "FETCH_USER_FAILURE", payload: user.data });
      }
    } catch (error) {
      dispatch({ type: "FETCH_USER_FAILURE", payload: error.message });
    }
  };
};

export const fetchLeagues = (user_id, season) => {
  return async (dispatch) => {
    dispatch({ type: "FETCH_LEAGUES_START" });

    try {
      const response = await fetch(
        `/league/upsert?user_id=${encodeURIComponent(
          user_id
        )}&season=${encodeURIComponent(season)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        }
      );

      if (response.ok) {
        const reader = response.body.getReader();

        let leagues = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          try {
            const batch = new TextDecoder().decode(value);

            leagues += batch;
          } catch (err) {
            console.log(err);
          }
          const matches = leagues.match(/{"league_id":/g);

          let count = 0;

          if (matches && matches.length > 0) {
            count = matches.length;
          }

          dispatch({
            type: "SET_STATE_PROGRESS",
            payload: { progress: count },
          });
        }

        let parsed_leagues;

        try {
          parsed_leagues = JSON.parse(leagues);
        } catch (error) {
          console.log(error);
        }

        const data = parsed_leagues.flat();

        dispatch({
          type: "FETCH_LEAGUES_SUCCESS",
          payload: data,
        });

        if (!data.find((league) => league.error)) {
          saveToDB(user_id, "leagues", {
            timestamp: new Date().getTime() + 60 * 60 * 10000,
            data: data,
          });
        }
      } else {
        dispatch({
          type: "FETCH_LEAGUES_FAILURE",
          payload: "Failed to fetch user leagues",
        });
      }
    } catch (error) {
      dispatch({ type: "FETCH_LEAGUES_FAILURE", payload: error.message });
    }
  };
};

export const syncLeague = (league_id, user_id) => {
  return async (dispatch, getState) => {
    const state = getState();

    const leagues = state.user.leagues;

    dispatch({ type: "SET_STATE_STANDINGS", payload: { syncing: true } });

    try {
      const league = await axios.get("/league/sync", {
        params: { league_id, user_id },
      });

      const league_to_replace_index = leagues.find(
        (l) => l.league_id === league_id
      ).index;

      const data = [
        ...leagues.filter((l) => l.league_id !== league_id),
        {
          ...league.data,
          index: league_to_replace_index,
        },
      ];
      dispatch({
        type: "FETCH_LEAGUES_SUCCESS",
        payload: data.sort((a, b) => a.index - b.index),
      });

      if (!data.find((league) => league.error)) {
        saveToDB(user_id, "leagues", {
          timestamp: new Date().getTime() + 60 * 60 * 10000,
          data: data,
        });
      }

      dispatch({ type: "SET_STATE_STANDINGS", payload: { syncing: false } });
    } catch (err) {
      console.log({ err });
      dispatch({ type: "SET_STATE_STANDINGS", payload: { syncing: false } });
    }
  };
};

export const fetchLmPlayerShares = (user_id) => async (dispatch) => {
  dispatch({ type: "SET_STATE_USER", payload: { isLoadingPS: true } });

  try {
    const lmplayershares = await axios.get("/user/lmplayershares", {
      params: { user_id: user_id },
    });

    console.log({
      lmplayershares: lmplayershares.data.sort((a, b) =>
        a.username > b.username ? 1 : -1
      ),
    });

    dispatch({
      type: "SET_STATE_USER",
      payload: { lmplayershares: lmplayershares.data, isLoadingPS: false },
    });
  } catch (err) {
    dispatch({
      type: "SET_STATE_USER",
      payload: { isLoadingPS: false, errorPS: err.message },
    });
  }
};

export const fetchPlayerValues = (player_ids) => {
  return async (dispatch) => {
    try {
      const pv = await axios.post("/main/playervalues", {
        player_ids: player_ids,
      });

      const values_dict = {};

      pv.data.forEach((value_obj) => {
        if (!values_dict[value_obj.date]) {
          values_dict[value_obj.date] = {};
        }

        if (!values_dict[value_obj.date][value_obj.player_id]) {
          values_dict[value_obj.date][value_obj.player_id] = {};
        }

        values_dict[value_obj.date][value_obj.player_id][value_obj.type] =
          value_obj.value;
      });

      dispatch({ type: "SET_STATE_COMMON", payload: { values: values_dict } });
    } catch (err) {
      console.log(err);
    }
  };
};

export const fetchLmLeagueIds = (user_id, type1, type2) => async (dispatch) => {
  try {
    const lmLeagueIds = await axios.get("/league/leaguemate", {
      params: { user_id, type1, type2 },
    });

    dispatch({
      type: "SET_STATE_USER",
      payload: { lmLeagueIds: lmLeagueIds.data },
    });

    saveToDB(user_id, "lmLeagueIds", {
      timestamp: new Date().getTime() + 60 * 60 * 10000,
      data: lmLeagueIds.data,
    });
  } catch (err) {
    console.log(err.message);
  }
};

export const fetchKTC = () => async (dispatch) => {
  try {
    const ktc = await axios.get("/common/ktcvalues");

    dispatch({ type: "SET_STATE_COMMON", payload: { ktc: ktc.data } });
  } catch (err) {
    console.log(err);
  }
};

export const fetchAdp =
  (league_ids, user_id, allplayers) => async (dispatch) => {
    dispatch({ type: "SET_STATE_USER", payload: { isLoadingAdp: true } });

    try {
      const adp = await axios.post("/draft/adp", {
        league_ids: league_ids,
      });

      const n_drafts_redraft = Math.max(
        ...adp.data.draft_picks
          .filter((x) => x.league_type === "R")
          .map((x) => parseInt(x.n_drafts))
      );

      const n_drafts_redraft_recent = Math.max(
        ...adp.data.draft_picks_recent
          .filter((x) => x.league_type === "R")
          .map((x) => parseInt(x.n_drafts))
      );

      const adp_redraft = Object.fromEntries(
        adp.data.draft_picks
          .filter((x) => x.league_type === "R")
          .map((x) => {
            const adp_ovr =
              (parseInt(x.n_drafts) * parseFloat(x.adp)) / n_drafts_redraft;

            const recent = adp.data?.draft_picks_recent.find(
              (pr) => pr.league_type === "R" && pr.player_id === x.player_id
            );

            const adp_recent =
              (parseInt(recent?.n_drafts) * parseFloat(recent?.adp)) /
              n_drafts_redraft_recent;

            return [
              x.player_id,
              {
                adp: recent?.adp ? (adp_recent + adp_ovr) / 2 : adp_ovr,
                n_drafts: parseInt(x.n_drafts),
              },
            ];
          })
      );

      const n_drafts_dynasty = Math.max(
        ...adp.data.draft_picks
          .filter((x) => x.league_type === "D")
          .map((x) => parseInt(x.n_drafts))
      );

      const n_drafts_dynasty_recent = Math.max(
        ...adp.data.draft_picks_recent
          .filter((x) => x.league_type === "D")
          .map((x) => parseInt(x.n_drafts))
      );

      const adp_dynasty = Object.fromEntries(
        adp.data.draft_picks
          .filter((x) => x.league_type === "D")
          .map((x) => {
            const adp_ovr =
              (parseInt(x.n_drafts) * parseFloat(x.adp)) / n_drafts_dynasty;

            const recent = adp.data.draft_picks_recent.find(
              (pr) => pr.league_type === "D" && pr.player_id === x.player_id
            );

            const adp_recent =
              (parseInt(recent?.n_drafts) * parseFloat(recent?.adp)) /
              n_drafts_dynasty_recent;

            return [
              x.player_id,
              {
                adp: recent?.adp ? (adp_recent + adp_ovr) / 2 : adp_ovr,
                n_drafts: parseInt(x.n_drafts),
              },
            ];
          })
      );

      const n_drafts_redraft_auction = Math.max(
        ...adp.data.auction_picks
          .filter((x) => x.league_type === "R")
          .map((x) => parseInt(x.n_drafts))
      );

      const n_drafts_redraft_auction_recent = Math.max(
        ...adp.data.auction_picks_recent
          .filter((x) => x.league_type === "R")
          .map((x) => parseInt(x.n_drafts))
      );

      const adp_redraft_auction = Object.fromEntries(
        adp.data.auction_picks
          .filter((x) => x.league_type === "R")
          .map((x) => {
            const adp_ovr =
              (parseInt(x.n_drafts) * parseFloat(x.adp)) /
              n_drafts_redraft_auction;

            const recent = adp.data.auction_picks_recent.find(
              (pr) => pr.league_type === "R" && pr.player_id === x.player_id
            );

            const adp_recent =
              parseInt(recent?.n_drafts) +
              parseFloat(recent?.adp) / n_drafts_redraft_auction_recent;

            return [
              x.player_id,
              {
                adp: recent?.adp ? (adp_recent + adp_ovr) / 2 : adp_ovr,
                n_drafts: parseInt(x.n_drafts),
              },
            ];
          })
      );

      const n_drafts_dynasty_auction = Math.max(
        ...adp.data.auction_picks
          .filter((x) => x.league_type === "D")
          .map((x) => parseInt(x.n_drafts))
      );

      const n_drafts_dynasty_auction_recent = Math.max(
        ...adp.data.auction_picks_recent
          .filter((x) => x.league_type === "D")
          .map((x) => parseInt(x.n_drafts))
      );

      const adp_dynasty_auction = Object.fromEntries(
        adp.data.auction_picks
          .filter(
            (x) =>
              x.league_type === "D" &&
              n_drafts_dynasty_auction &&
              parseInt(x.n_drafts) > n_drafts_dynasty_auction / 5
          )
          .map((x) => {
            const adp_ovr =
              (parseInt(x.n_drafts) * parseFloat(x.adp)) /
              n_drafts_dynasty_auction;

            const recent = adp.data.auction_picks_recent.find(
              (pr) => pr.league_type === "D" && pr.player_id === x.player_id
            );

            const adp_recent =
              (parseInt(recent?.n_drafts) * parseFloat(recent?.adp)) /
              n_drafts_dynasty_auction_recent;

            return [
              x.player_id,
              {
                adp: recent?.adp ? (adp_recent + adp_ovr) / 2 : adp_ovr,
                n_drafts: parseInt(x.n_drafts),
              },
            ];
          })
      );

      const adp_object = {
        Redraft: adp_redraft,
        Dynasty: adp_dynasty,
        Redraft_auction: adp_redraft_auction,
        Dynasty_auction: adp_dynasty_auction,
      };

      dispatch({
        type: "SET_STATE_USER",
        payload: { adpLm: adp_object, isLoadingAdp: false },
      });

      saveToDB(user_id, "lmAdp", {
        timestamp: new Date().getTime() + 60 * 60 * 10000,
        data: adp_object,
      });
    } catch (err) {
      console.log(err);
      dispatch({
        type: "SET_STATE_USER",
        payload: { errorAdp: err.message },
      });
    }
  };
