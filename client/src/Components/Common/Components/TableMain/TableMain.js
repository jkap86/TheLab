import "./TableMain.css";
import Avatar from "../Avatar";
import React, { useEffect, useRef } from "react";
import Search from "../Search";

const TableMain = ({
  id,
  type,
  headers,
  body,
  page,
  setPage,
  itemActive,
  setItemActive,
  caption,
  searched,
  setSearched,
  placeholder,
  options1,
  options2,
  partial,
  loadMore,
}) => {
  const pageRef = useRef(null);
  const itemActiveRef = useRef(null);

  useEffect(() => {
    if (pageRef.current !== null) {
      pageRef.current.focus();
      pageRef.current.scrollIntoView({
        behavior: "smooth",
        inline: "center",
      });
    }
  }, [pageRef, page]);

  useEffect(() => {
    if (itemActiveRef.current !== null && !type.includes("half")) {
      itemActiveRef.current.focus();
      itemActiveRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [itemActiveRef, itemActive]);

  useEffect(() => {
    if (
      page &&
      page !== 1 &&
      body &&
      !body
        ?.filter((x) => x)
        ?.slice(
          Math.max(((page || 1) - 1) * 25, 0),
          ((page || 1) - 1) * 25 + 25
        )?.length > 0
    ) {
      setPage(1);
    }
  }, [body, page]);

  return (
    <div className={type}>
      {setSearched ? (
        <div className="search_filter_wrapper">
          <div>{options1?.map((option) => option)}</div>
          <Search
            id={id}
            placeholder={placeholder}
            list={body
              ?.filter(
                (b, index) =>
                  b.search?.text !== "orphan" ||
                  !body.slice(0, index).find((x) => x.search?.text === "orphan")
              )
              ?.map((b) => {
                return {
                  ...b.search,
                  id: b.id,
                };
              })}
            searched={searched}
            setSearched={setSearched}
          />
          <div>{options2?.map((option) => option)}</div>
        </div>
      ) : null}
      {page ? (
        <div className="page_numbers_wrapper">
          <>
            {Math.ceil(body?.length / 25) <= 1 ? null : (
              <ol className="page_numbers">
                {Array.from(
                  Array(Math.ceil(body?.length / 25 || 0)).keys()
                ).map((page_number) => (
                  <li
                    className={
                      page === page_number + 1 ? "active click" : "click"
                    }
                    key={page_number + 1}
                    onClick={() => setPage(page_number + 1)}
                    ref={page === page_number + 1 ? pageRef : null}
                  >
                    {page_number + 1}
                  </li>
                ))}
                {partial ? (
                  <li className="click" onClick={loadMore}>
                    ...
                  </li>
                ) : null}
              </ol>
            )}
          </>
        </div>
      ) : null}

      <table className={type} id={id}>
        {caption ? <caption>{caption}</caption> : null}
        <thead>
          {headers?.map((header, index) => (
            <tr key={index}>
              {header
                .filter((x) => x)
                .map((key, index) => (
                  <th
                    key={index}
                    colSpan={key?.colSpan}
                    rowSpan={key?.rowSpan}
                    className={key?.className}
                    onClick={key?.onClick}
                  >
                    {key?.text}
                  </th>
                ))}
            </tr>
          ))}
        </thead>
        {body?.length > 0 && page > 1 ? (
          <tbody>
            <tr className={"click"} onClick={() => setPage(page - 1)}>
              <td
                colSpan={headers[0].reduce(
                  (acc, cur) => acc + (cur.colSpan || 0),
                  0
                )}
              >
                PREV PAGE
              </td>
            </tr>
          </tbody>
        ) : null}
        {body?.length > 0 ? (
          <tbody>
            {body
              ?.filter((x) => x)
              ?.sort((a, b) => b.sort - a.sort)
              ?.slice(
                Math.max(((page || 1) - 1) * 25, 0),
                page
                  ? ((page || 1) - 1) * 25 + 25
                  : body?.filter((x) => x).length
              )
              ?.map((item, index) => (
                <tr
                  key={index}
                  className={itemActive === item.id ? "active_wrapper" : ""}
                >
                  <td
                    colSpan={item.list?.reduce(
                      (acc, cur) => acc + (cur?.colSpan || 0),
                      0
                    )}
                  >
                    <table
                      className={`body ${
                        itemActive === item.id ? "active" : ""
                      }`}
                    >
                      <tbody>
                        <tr
                          className={`click ${
                            itemActive === item.id ? "active" : ""
                          }`}
                          ref={
                            itemActive === item.id &&
                            !type?.split(" ")?.includes("lineup")
                              ? itemActiveRef
                              : null
                          }
                          onClick={
                            setItemActive
                              ? () =>
                                  itemActive === item.id
                                    ? setItemActive("")
                                    : setItemActive(item.id)
                              : null
                          }
                        >
                          {item.list
                            ?.filter((x) => x?.text)
                            ?.map((key, index) => (
                              <td
                                key={index}
                                colSpan={key.colSpan}
                                className={
                                  type +
                                  " " +
                                  (key.className ? key.className : "")
                                }
                              >
                                {key.image ? (
                                  <>
                                    <span className="image">
                                      <Avatar
                                        avatar_id={key.image.src}
                                        alt={key.image.alt}
                                        type={key.image.type}
                                      />

                                      {key.text}
                                    </span>
                                  </>
                                ) : (
                                  key.text
                                )}
                              </td>
                            ))}
                        </tr>
                      </tbody>
                      <tbody>
                        {itemActive !== item.id ||
                        !item.secondary_table ? null : (
                          <tr
                            className={`${type} click ${
                              itemActive === item.id ? "active2" : ""
                            }`}
                          >
                            <td
                              colSpan={item.list.reduce(
                                (acc, cur) => acc + (cur?.colSpan || 0),
                                0
                              )}
                            >
                              {item.secondary_table}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </td>
                </tr>
              ))}
          </tbody>
        ) : (
          <tbody>
            <tr>
              <td
                colSpan={headers?.[0]?.reduce(
                  (acc, cur) => acc + (cur?.colSpan || 0),
                  0
                )}
              >
                ...
              </td>
            </tr>
          </tbody>
        )}
        {body
          ?.filter((x) => x)
          ?.slice(
            Math.max(((page || 1) - 1) * 25, 0),
            ((page || 1) - 1) * 25 + 25
          )?.length > 0 &&
        ((page - 1) * 25 + 25 < body?.length || partial) ? (
          <tbody>
            <tr
              className={"click"}
              onClick={
                (page - 1) * 25 + 25 < body?.length
                  ? () => setPage(page + 1)
                  : loadMore
              }
            >
              <td
                colSpan={headers[0].reduce(
                  (acc, cur) => acc + (cur.colSpan || 0),
                  0
                )}
              >
                NEXT PAGE
              </td>
            </tr>
          </tbody>
        ) : null}
      </table>
    </div>
  );
};

export default React.memo(TableMain);
