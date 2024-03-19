const TeamFilter = ({filterTeam, setFilterTeam}) => {
    const nfl_teams = [
        'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
        'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN',
        'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF', 'SEA', 'TB', 'TEN', 'WAS'
    ]

    return <span className="team" key={'team'}>
        <label>
            <img
                className={'thumbnail icon'}
                alt='filter_team'
                src={`https://a.espncdn.com/combiner/i?img=/i/teamlogos/nfl/500/${filterTeam}.png`}
                onError={(e) => { return e.target.src = `https://a.espncdn.com/combiner/i?img=/i/teamlogos/leagues/500/nfl.png` }}
            />
            <select
                className="hidden_behind click"
                onChange={(e) => setFilterTeam(e.target.value)}
                value={filterTeam}
            >
                <option>All</option>
                {nfl_teams.map(team =>
                    <option key={team}>{team}</option>
                )}
            </select>
        </label>
    </span>
}

export default TeamFilter;