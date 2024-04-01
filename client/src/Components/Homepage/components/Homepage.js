import { Link } from "react-router-dom";
import { useEffect } from "react";
import thelablogo from "../../../Images/thelab.png";
import { useDispatch, useSelector } from "react-redux";
import { setStateHome } from "../redux/actions";
import { fetchCommon, resetState } from "../../Common/Redux/actions";
import Heading from "../../Common/Components/Heading";
import "./Homepage.css";

const Homepage = () => {
  const dispatch = useDispatch();
  const { recent_users } = useSelector((state) => state.common);
  const { username_searched, leagueId, tab } = useSelector(
    (state) => state.homepage
  );

  // Effect hook to reset state on component mount
  useEffect(() => {
    dispatch(resetState());
    dispatch(fetchCommon("recent_users"));
  }, [dispatch]);

  return (
    <div id="homepage">
      {/* Heading component for the homepage - only South Harmon Links */}
      <Heading homepage={true} />

      {/* Picktracker section */}
      <div className="picktracker">
        {/* Toggle between username and picktracker tab */}
        <p
          className="home click"
          onClick={() =>
            dispatch(
              setStateHome({
                tab: tab === "username" ? "picktracker" : "username",
              })
            )
          }
        >
          picktracker
        </p>

        {/* Show input field and submit link if tab is 'picktracker' */}
        {tab === "picktracker" ? (
          <>
            <input
              onChange={(e) =>
                dispatch(setStateHome({ leagueId: e.target.value }))
              }
              className="picktracker"
              placeholder="League ID"
            />

            {/* Link to navigate based on league ID */}
            <Link className="home" to={`/picktracker/${leagueId.trim()}`}>
              Submit
            </Link>
          </>
        ) : null}
      </div>

      <div className="home_wrapper">
        {/* The lab logo */}
        <img alt="sleeper_logo" className="home" src={thelablogo} />

        <div className="home_title">
          <strong className="home">The Lab</strong>
          <div>
            <div className="user_input">
              {/* Input for username search */}
              <input
                id="sleeper_username"
                className="home"
                type="text"
                placeholder="Username"
                onChange={(e) =>
                  dispatch(setStateHome({ username_searched: e.target.value }))
                }
                list="users"
              />

              <datalist id="users">
                {(recent_users || []).map((username) => {
                  return <option key={username} value={username}></option>;
                })}
              </datalist>
            </div>

            {/* Submit link to navigate to page */}
            <Link
              className="link click"
              to={`/${
                localStorage.getItem("navTab") || "leagues"
              }/${username_searched}`}
            >
              Submit
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Homepage;
