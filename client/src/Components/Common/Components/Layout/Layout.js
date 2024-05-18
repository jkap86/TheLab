import Heading from "../Heading";
import { useSelector } from "react-redux";
import { useState } from "react";
import { useLocation } from "react-router-dom";
import LoadingIcon from "../LoadingIcon";
import useFetchUserInfo from "../../Hooks/useFetchUserInfo";

const Layout = ({ display }) => {
  const location = useLocation();
  const { isLoadingUser, isLoadingLeagues, errorUser } = useSelector(
    (state) => state.user
  );
  const [isLegendVisible, setIsLegendVisible] = useState(false);

  const navTab = location.pathname.split("/")[1];

  useFetchUserInfo([]);

  return (
    <>
      <Heading />
      {isLoadingUser || isLoadingLeagues ? (
        <LoadingIcon />
      ) : (
        (errorUser.error && <h1 className="error">{errorUser.error}</h1>) || (
          <>
            {navTab.toLowerCase() !== "trades" && (
              <div className="relative">
                <i
                  className="fa-regular fa-circle-question"
                  onClick={() => setIsLegendVisible((prevState) => !prevState)}
                ></i>
                {isLegendVisible && (
                  <div className="legend">
                    <table className="legend">
                      <tbody>
                        {[
                          {
                            label: "Rank",
                            desc: "League rank based on sleeper average auction draft budget percentages",
                          },
                          {
                            label: "D",
                            desc: "Dynasty",
                          },
                          {
                            label: "R",
                            desc: "Redraft (includes current year picks)",
                          },
                          {
                            label: "KTC",
                            desc: "KeepTradeCut.com Dynasty Superflex values",
                          },
                          {
                            label: "Starters",
                            desc: "Players in starting lineup when optimal lineup is set",
                          },
                          {
                            label: "Bench",
                            desc: "Players NOT in starting lineup when optimal lineup is set (includes Taxi and IR)",
                          },
                        ].map((col) => {
                          return (
                            <tr key={col.label}>
                              <td>
                                <strong>{col.label}</strong>
                              </td>
                              <td>{col.desc}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {display}
          </>
        )
      )}
    </>
  );
};

export default Layout;
