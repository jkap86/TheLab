
export const filterLeagues = (leagues, type1, type2) => {
    return (leagues || []).filter(league => {
        let include_1;

        switch (type1) {
            case ('Redraft'):
                include_1 = league.settings.type !== 2;
                break;
            case ('All'):
                include_1 = true;
                break;
            case ('Dynasty'):
                include_1 = league.settings.type === 2;
                break;
            default:
                include_1 = true;
                break;
        }

        let include_2;

        switch (type2) {
            case ('Bestball'):
                include_2 = league.settings.best_ball === 1;
                break;
            case ('All'):
                include_2 = true;
                break;
            case ('Lineup'):
                include_2 = league.settings.best_ball !== 1;
                break;
            default:
                include_2 = true;
                break;
        }

        return (include_1 && include_2)
    })
}