import Heading from "../Heading";
import { useSelector } from "react-redux";
import LoadingIcon from "../LoadingIcon";
import useFetchUserInfo from "../../Hooks/useFetchUserInfo";

const Layout = ({ display }) => {
  const { isLoadingUser, isLoadingLeagues, errorUser } = useSelector(
    (state) => state.user
  );

  useFetchUserInfo([]);

  return (
    <>
      <Heading />
      {isLoadingUser || isLoadingLeagues ? (
        <LoadingIcon />
      ) : (
        (errorUser.error && <h1 className="error">{errorUser.error}</h1>) ||
        display
      )}
    </>
  );
};

export default Layout;
