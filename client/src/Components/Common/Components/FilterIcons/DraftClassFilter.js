

const DraftClassFilter = ({filterDraftClass, setFilterDraftClass, draftClassYears}) => {


    return <span className="team" key={'draft'}>
        <label>
            {
                <>
                    <i className="fa-solid fa-graduation-cap icon"></i>
                    <strong className="draft-year"><em>{filterDraftClass !== 'All' && filterDraftClass}</em></strong>
                </>
            }
            <select
                className="hidden_behind click"
                onChange={(e) => setFilterDraftClass(e.target.value)}
                value={filterDraftClass}
            >
                <option>All</option>
                {
                    draftClassYears?.map(year =>
                        <option key={year}>{year}</option>
                    )
                }
            </select>
        </label>
    </span>
}

export default DraftClassFilter;
