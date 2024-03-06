import loading_flask from "../../../../Images/loading_flask.png";
import bubble1 from "../../../../Images/bubble1.png";
import "./LoadingIcon.css";

const LoadingIcon = () => {
  return (
    <div className="loading">
      <img className="loading" src={loading_flask} alt={"logo"} />

      {Array.from(Array(25).keys()).map((key) => {
        const className = "z_" + ((key % 5) + 1);
        return (
          <div className={className} key={key}>
            <img className={className} src={bubble1} alt={"bubble1"} />
          </div>
        );
      })}
    </div>
  );
};

export default LoadingIcon;
