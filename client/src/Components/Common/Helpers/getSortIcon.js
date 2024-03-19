export const getSortIcon = (colNum, sortBy, dispatch, setState) => {
  return (
    <div
      onClick={() =>
        dispatch(
          setState({
            sortBy: {
              column: colNum,
              asc: sortBy.column === colNum ? !sortBy.asc : sortBy.asc,
            },
          })
        )
      }
      className={sortBy?.column === colNum ? "active" : ""}
    >
      {sortBy?.column === colNum ? (
        !sortBy?.asc ? (
          <i className="fa-solid fa-caret-down active"></i>
        ) : (
          <i className="fa-solid fa-caret-up active"></i>
        )
      ) : !sortBy?.asc ? (
        <i className="fa-solid fa-caret-down"></i>
      ) : (
        <i className="fa-solid fa-caret-up"></i>
      )}
    </div>
  );
};
