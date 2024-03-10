import React, { useState, useEffect, useCallback } from "react";
import Avatar from "../Avatar";
import "./Search.css";

const Search = ({
  id,
  placeholder,
  list,
  isLoading,
  searched,
  setSearched,
}) => {
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownOptions, setDropdownOptions] = useState([]);
  const [reverse, setReverse] = useState(false);

  const getOptions = useCallback(
    (s) => {
      const all_options = list;
      const options = all_options
        .filter((x) =>
          x.text
            ?.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .includes(
              s
                .replace(/[^a-z0-9]/g, "")
                .trim()
                .toLowerCase()
            )
        )
        .sort((a, b) =>
          b.text
            ?.trim()
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "")
            .startsWith(
              s
                .replace(/[^a-z0-9]/g, "")
                .trim()
                .toLowerCase()
            )
            ? 1
            : -1
        );

      return options;
    },
    [list]
  );

  const handleSearch = (input) => {
    let s = input;
    let options;
    let visible;

    if (s === "") {
      options = [];
      visible = false;
      setSearched(s);
    } else if (
      list
        .map((x) => x.text?.trim().toLowerCase())
        .includes(s.trim().toLowerCase())
    ) {
      const option = list.find(
        (x) => x.text?.trim().toLowerCase() === s.trim().toLowerCase()
      );
      options = [];
      visible = false;
      setSearched(option);
    } else {
      options = getOptions(s);
      visible = true;
      setSearched(s);
    }
    setDropdownVisible(visible);
    setDropdownOptions(options);
  };

  const handleMouseEnter = (value) => {
    setTimeout(() => {
      setReverse(value);
    }, 2000);
  };

  return (
    <>
      <div
        onBlur={() => setDropdownVisible(false)}
        className={"search_wrapper"}
      >
        {searched?.image ? (
          <Avatar
            avatar_id={searched.image.src}
            alt={searched.image.alt}
            type={searched.image.type}
          />
        ) : null}
        <input
          className={"search"}
          onChange={(e) => handleSearch(e.target.value)}
          onFocus={() => setDropdownVisible(true)}
          id={id === undefined ? null : id}
          placeholder={`Search ${(placeholder && placeholder) || ""}...`}
          type="text"
          value={searched?.text || searched}
          autoComplete={"off"}
          disabled={isLoading}
        />
        {searched === "" ||
        (!dropdownVisible && searched !== "" && dropdownVisible) ? (
          <button onClick={() => handleSearch(" ")} className={"input click"}>
            &#9660;
          </button>
        ) : (
          <button
            type="reset"
            onClick={() => handleSearch("")}
            className={"input click"}
          >
            X
          </button>
        )}
        {dropdownVisible && dropdownOptions.length > 0 && !isLoading ? (
          <ol onBlur={() => setDropdownVisible(false)} className="dropdown">
            {dropdownOptions.map((option, index) => (
              <li key={`${option.text}_${index}`}>
                <button
                  className={
                    "click " +
                    (`${option.text}_${index}` === reverse ? "reverse" : "")
                  }
                  onMouseEnter={() =>
                    handleMouseEnter(`${option.text}_${index}`)
                  }
                  onMouseLeave={() => setReverse(false)}
                  onMouseDown={() => setSearched(option)}
                >
                  {option.image ? (
                    <p>
                      {
                        <Avatar
                          avatar_id={option.image.src}
                          alt={option.image.alt}
                          type={option.image.type}
                        />
                      }
                      <span>{option.text}</span>
                    </p>
                  ) : (
                    option.text
                  )}
                </button>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </>
  );
};

export default Search;
