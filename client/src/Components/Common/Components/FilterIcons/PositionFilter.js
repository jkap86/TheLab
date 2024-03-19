const PositionFilter = ({ filterPosition, setFilterPosition, picks }) => {
  return (
    <span className="team" key={"position"}>
      <label>
        <div
          className={
            ["All", "Picks"].includes(filterPosition)
              ? "position_square1"
              : `position_square${filterPosition.split("/").length}`
          }
        >
          {filterPosition.split("/").includes("W") ||
          filterPosition === "WR" ? (
            <div className="wr">{filterPosition === "WR" ? "WR" : "W"}</div>
          ) : null}
          {filterPosition.split("/").includes("R") ||
          filterPosition === "RB" ? (
            <div className="rb">{filterPosition === "RB" ? "RB" : "R"}</div>
          ) : null}
          {filterPosition.split("/").includes("T") ||
          filterPosition === "TE" ? (
            <div className="te">{filterPosition === "TE" ? "TE" : "T"}</div>
          ) : null}
          {filterPosition.split("/").includes("Q") ||
          filterPosition === "QB" ? (
            <div className="qb">{filterPosition === "QB" ? "QB" : "Q"}</div>
          ) : null}
          {["All", "Picks"].includes(filterPosition) ? (
            <div className="picks">{filterPosition}</div>
          ) : null}
        </div>
        <select
          className="hidden_behind click"
          onChange={(e) => setFilterPosition(e.target.value)}
          value={filterPosition}
        >
          <option>W/R/T/Q</option>
          <option>W/R/T</option>
          <option>W/R</option>
          <option>W/T</option>
          <option>QB</option>
          <option>RB</option>
          <option>WR</option>
          <option>TE</option>
          <option>Picks</option>
          <option>All</option>
        </select>
      </label>
    </span>
  );
};

export default PositionFilter;
