import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchLeaguemates } from "../redux/actions";

const useFetchLeaguemates = () => {
  const dispatch = useDispatch();
  const { leagues, leaguemates } = useSelector((state) => state.user);

  useEffect(() => {
    if (leagues && !leaguemates) {
      dispatch(fetchLeaguemates(leagues));
    }
  }, [dispatch, leagues, leaguemates]);
};

export default useFetchLeaguemates;
