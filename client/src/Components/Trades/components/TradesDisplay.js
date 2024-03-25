import TableMain from "../../Common/Components/TableMain";
import Trade from "./Trade";
import { position_map } from "../../Common/Helpers/getOptimalLineupADP";
import { useSelector, useDispatch } from "react-redux";
import { setStateTradesNav, setStateLmTrades } from "../redux/actions";
import HeaderDropdown from "../../Common/Components/HeaderDropdown";

const TradesDisplay = ({ secondaryTable, trades }) => {
  const { allplayers } = useSelector((state) => state.common);
  const { adpLm } = useSelector((state) => state.user);
  const { page } = useSelector((state) => state.trades.lmtrades);
  const dispatch = useDispatch();
  const { tabPrimary, valueType } = useSelector((state) => state.trades.nav);

  const trades_headers = [
    [
      {
        text: (
          <HeaderDropdown
            column_text={tabPrimary}
            columnOptions={[
              "Price Check",
              "Leaguemate League Trades",
              "Leaguemate Trades",
              "Trade Tips",
            ]}
            setState={(value) =>
              dispatch(setStateTradesNav({ tabPrimary: value }))
            }
          />
        ),
        colSpan: 10,
      },
    ],
    [
      {
        text: "",
        colSpan: 4,
      },
      {
        text: (
          <HeaderDropdown
            column_text={valueType}
            columnOptions={["KTC", "ADP", "Auction %"]}
            setState={(value) =>
              dispatch(setStateTradesNav({ valueType: value }))
            }
          />
        ),
        colSpan: 2,
      },
      {
        text: "",
        colSpan: 4,
      },
    ],
  ];

  const trades_body = (trades || [])
    ?.sort((a, b) => parseInt(b.status_updated) - parseInt(a.status_updated))
    ?.map((trade) => {
      const rosters = Object.values(trade.rosters).map((roster) => {
        const starters = [];

        trade["league.roster_positions"]
          .filter((slot) => Object.keys(position_map).includes(slot))
          .forEach((slot) => {
            const league_type =
              trade["league.settings"].type === 2
                ? "Dynasty"
                : trade["league.settings"].type === 0
                ? "Redraft"
                : "All";

            const players_slot = roster.players
              ?.filter(
                (player_id) =>
                  position_map[slot].some((p) =>
                    allplayers[player_id]?.fantasy_positions?.includes(p)
                  ) && !starters.includes(player_id)
              )
              ?.sort(
                (a, b) =>
                  (adpLm?.[league_type]?.[a]?.adp || 999) -
                  (adpLm?.[league_type]?.[b]?.adp || 999)
              );

            starters.push(players_slot?.[0] || "0");
          });

        return {
          ...roster,
          starters: starters,
        };
      });

      const league = {
        avatar: trade["league.avatar"],
        league_id: trade["league.league_id"],
        name: trade["league.name"],
        roster_positions: trade["league.roster_positions"],
        scoring_settings: trade["league.scoring_settings"],
        settings: trade["league.settings"],
      };

      return {
        id: trade.transaction_id,
        list: [
          {
            text: <Trade trade={trade} />,
            colSpan: 10,
          },
        ],
        secondary_table: "", //secondaryTable({ rosters, league, trade }),
      };
    });

  return (
    <TableMain
      type={"primary trades"}
      headers={trades_headers}
      body={trades_body}
      page={page}
      setPage={(value) => dispatch(setStateLmTrades({ page: value }))}
    />
  );
};
export default TradesDisplay;
