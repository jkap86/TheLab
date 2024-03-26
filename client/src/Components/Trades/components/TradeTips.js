import TableMain from "../../Common/Components/TableMain";
import { useState } from "react";
import { useSelector } from "react-redux";

const TradeTips = ({ trade, secondaryTable }) => {
  const { allplayers } = useSelector((state) => state.common);
  const [itemActive, setItemActive] = useState("");

  const trade_acquisitions_headers = [
    [
      {
        text: "Manager",
        colSpan: 3,
      },
      {
        text: "Acquire",
        colSpan: 3,
      },
      {
        text: "League",
        colSpan: 3,
      },
    ],
  ];

  const trade_acquisitions_body =
    !trade.tips?.acquire?.length > 0
      ? [{ id: "NONE", list: [{ text: "-", colSpan: 9 }] }]
      : trade.tips?.acquire?.map((add, index) => {
          return {
            id: `${add.manager.user_id}_${
              add.type === "player"
                ? allplayers[add.player_id]?.full_name
                : `${add.player_id}_${index}`
            }_${add.league.league_id}`,
            list: [
              {
                text: add.manager.username,
                colSpan: 3,
                className: "left",
                image: {
                  src: add.manager.avatar,
                  alt: "manager avatar",
                  type: "user",
                },
              },
              {
                text:
                  add.type === "player"
                    ? allplayers[add.player_id]?.full_name
                    : add.player_id,
                colSpan: 3,
                className: "left",
                image: {
                  src: add.player_id,
                  alt: "player headshot",
                  type: "player",
                },
              },
              {
                text: add.league.name,
                colSpan: 3,
                className: "left end",
                image: {
                  src: add.league.avatar,
                  alt: "league avatar",
                  type: "league",
                },
              },
            ],
            secondary_table: "",
          };
        });

  const trade_flips_headers = [
    [
      {
        text: "Manager",
        colSpan: 3,
      },
      {
        text: "Flip",
        colSpan: 3,
      },
      {
        text: "League",
        colSpan: 3,
      },
    ],
  ];

  const trade_flips_body =
    !trade.tips?.trade_away?.length > 0
      ? [{ id: "NONE", list: [{ text: "-", colSpan: 9 }] }]
      : trade.tips?.trade_away?.map((add, index) => {
          return {
            id: `${add.manager.user_id}_${
              add.type === "player"
                ? allplayers[add.player_id]?.full_name
                : `${add.player_id}_${index}`
            }_${add.league.league_id}`,
            list: [
              {
                text: add.manager.username,
                colSpan: 3,
                className: "left",
                image: {
                  src: add.manager.avatar,
                  alt: "manager avatar",
                  type: "user",
                },
              },
              {
                text:
                  add.type === "player"
                    ? allplayers[add.player_id]?.full_name
                    : add.player_id,
                colSpan: 3,
                className: "left",
                image: {
                  src: add.player_id,
                  alt: "player headshot",
                  type: "player",
                },
              },
              {
                text: add.league.name,
                colSpan: 3,
                className: "left end",
                image: {
                  src: add.league.avatar,
                  alt: "league avatar",
                  type: "league",
                },
              },
            ],
            secondary_table: "",
          };
        });

  return (
    <>
      <TableMain
        type={"secondary trade_tips"}
        headers={trade_acquisitions_headers}
        body={trade_acquisitions_body}
        itemActive={itemActive}
        setItemActive={setItemActive}
      />

      <TableMain
        type={"secondary trade_tips"}
        headers={trade_flips_headers}
        body={trade_flips_body}
        itemActive={itemActive}
        setItemActive={setItemActive}
      />
    </>
  );
};

export default TradeTips;
