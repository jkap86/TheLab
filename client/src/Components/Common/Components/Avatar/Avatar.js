import league_avatar from "../../../../Images/league_avatar.png";
import user_avatar from "../../../../Images/user_avatar.jpeg";
import player_avatar from "../../../../Images/headshot.png";
import "./Avatar.css";

const Avatar = ({ avatar_id, alt, type }) => {
  let source;
  let onError = null;
  switch (type) {
    case "league":
      source = avatar_id
        ? `https://sleepercdn.com/avatars/${avatar_id}`
        : league_avatar;
      break;
    case "user":
      source = avatar_id
        ? `https://sleepercdn.com/avatars/${avatar_id}`
        : user_avatar;
      break;
    case "player":
      source = `https://sleepercdn.com/content/nfl/players/thumb/${avatar_id}.jpg`;
      onError = (e) => {
        return (e.target.src = player_avatar);
      };
      break;
    default:
      source = avatar_id
        ? `https://sleepercdn.com/avatars/${avatar_id}`
        : league_avatar;
      break;
  }
  const image = (
    <img alt={alt} src={source} onError={onError} className="thumbnail" />
  );

  return image;
};

export default Avatar;
