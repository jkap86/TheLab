import "./HeaderDropdown.css";

const HeaderDropdown = ({ column_text, columnOptions, setState }) => {
  return (
    <>
      <span>{column_text}</span>
      <select
        value={column_text}
        className="hidden_behind click"
        onChange={(e) => setState(e.target.value)}
      >
        {columnOptions.map((column) => {
          return <option key={column}>{column}</option>;
        })}
      </select>
    </>
  );
};

export default HeaderDropdown;
