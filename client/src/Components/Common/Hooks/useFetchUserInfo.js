import { useEffect } from "react";
import { useParams } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import {
  resetState,
  fetchUser,
  fetchLeagues,
  fetchCommon,
  fetchAdp,
  fetchLmLeagueIds,
} from "../Redux/actions";
import { checkIndexedDB, clearIndexedDB } from "../Helpers/indexedDb";

const useFetchUserInfo = () => {
  const dispatch = useDispatch();
  const params = useParams();
  const {
    user_id,
    isLoadingUser,
    errorUser,
    username,
    leagues,
    isLoadingLeagues,
    errorLeagues,
    lmLeagueIds,
    type1,
    type2,
    adpLm,
  } = useSelector((state) => state.user);
  const { allplayers, state } = useSelector((state) => state.common);

  // Fetch common data if not already loaded

  useEffect(() => {
    if (!state) {
      dispatch(fetchCommon("state"));
    }
  }, [state]);

  // Reset state if the username changes

  useEffect(() => {
    if (
      username &&
      username?.toLowerCase() !== params.username?.toLowerCase()
    ) {
      console.log("RESETTING STATE...");
      dispatch(resetState());
    }
  }, [dispatch, username, params.username]);

  // Fetch user information if not loaded or loading or if there's an error

  useEffect(() => {
    if (!user_id && !isLoadingUser && !errorUser) {
      dispatch(fetchUser(params.username));
    }
  }, [dispatch, user_id, params.username, errorUser, isLoadingUser]);

  // Fetch leagues information if not loaded and user ID is available

  useEffect(() => {
    if (user_id && state && !leagues && !isLoadingLeagues && !errorLeagues) {
      checkIndexedDB(
        user_id,
        "leagues",
        () => dispatch(fetchLeagues(user_id, state.league_season)),
        (data) => dispatch({ type: "FETCH_LEAGUES_SUCCESS", payload: data })
      );
    }
  }, [dispatch, user_id, state, leagues, isLoadingLeagues, errorLeagues]);

  // Fetch leaguemates IDs if not already loaded

  useEffect(() => {
    if ((user_id, leagues && !lmLeagueIds)) {
      checkIndexedDB(
        user_id,
        "lmLeagueIds",
        () => dispatch(fetchLmLeagueIds(user_id, type1, type2)),
        (data) =>
          dispatch({
            type: "SET_STATE_USER",
            payload: { lmLeagueIds: data },
          })
      );
    }
  }, [dispatch, leagues, lmLeagueIds, user_id]);

  // Fetch allplayers data from IndexedDB or fetch api if not present

  useEffect(() => {
    if (leagues) {
      if (!allplayers) {
        try {
          checkIndexedDB(
            "COMMON",
            "allplayers",
            () => dispatch(fetchCommon("allplayers")),
            (data) =>
              dispatch({
                type: "FETCH_COMMON_SUCCESS",
                payload: { item: "allplayers", data: data },
              })
          );
        } catch (err) {
          // If there's an error, clear IndexedDB and retry fetching

          const retry = async () => {
            await clearIndexedDB("COMMON");
          };

          retry();
        }
      }
    }
  }, [dispatch, allplayers, leagues]);

  // Fetch ADP data for leaguemates if not already loaded
  /*
  useEffect(() => {
    if (lmLeagueIds && allplayers && !adpLm) {
      checkIndexedDB(
        user_id,
        "lmAdp",
        () => dispatch(fetchAdp(lmLeagueIds, user_id, allplayers)),
        (data) =>
          dispatch({
            type: "SET_STATE_USER",
            payload: { adpLm: data },
          })
      );
    }
  }, [dispatch, lmLeagueIds, adpLm, user_id, allplayers]);
*/
};

export default useFetchUserInfo;
