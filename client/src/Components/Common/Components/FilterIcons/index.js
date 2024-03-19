import './FilterIcons.css';
import IncludeTaxiFilter from './IncludeTaxiFilter';
import TeamFilter from './TeamFilter';
import PositionFilter from './PositionFilter';
import DraftClassFilter from './DraftClassFilter';

const FilterIcons = ({ type, ...props }) => {

    switch (type) {
        case 'taxi':
            return <IncludeTaxiFilter {...props} />;
        case 'team':
            return <TeamFilter {...props} />;
        case 'position':
            return <PositionFilter {...props} />;
        case 'draft':
            return <DraftClassFilter {...props} />;
        default:
            return null;

    }

}

export default FilterIcons;