import { useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { getPlayerShares } from "../redux/actions";

const useFetchPlayerShares = () => {
  const dispatch = useDispatch();
  const { leagues, userPlayerShares } = useSelector((state) => state.user);

  useEffect(() => {
    if (leagues && !userPlayerShares) {
      dispatch(getPlayerShares(leagues));
    }
  }, [dispatch, leagues, userPlayerShares]);
};

export default useFetchPlayerShares;
