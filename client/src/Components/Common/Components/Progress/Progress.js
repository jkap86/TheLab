import { useSelector } from "react-redux";
import "./Progress.css";

const Progress = () => {
  const { progress } = useSelector((state) => state.progress);

  return <h1 className="progress">{progress} Leagues Loaded...</h1>;
};

export default Progress;
