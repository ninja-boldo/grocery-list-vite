import logging
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

_SORT_MODE_TO_SQL: dict[str, str] = {
    "a-z":     "ORDER BY it.item_name ASC",
    "z-a":     "ORDER BY it.item_name DESC",
    "new-old": "ORDER BY MAX(inv.created_at) DESC NULLS LAST",
    "old-new": "ORDER BY MIN(inv.created_at) ASC NULLS LAST",
}
_DEFAULT_SORT = "new-old"


@lru_cache(maxsize=32)
def get_distinct_query(field: str) -> str:
    """Cached query builder for distinct field values."""
    return (
        f"SELECT DISTINCT {field} FROM item_list "
        f"WHERE {field} != '' AND {field} IS NOT NULL ORDER BY {field}"
    )


def convertSortToSql(sortMode: str | None = None) -> str:
    key = (sortMode or _DEFAULT_SORT).lower().strip()
    if key not in _SORT_MODE_TO_SQL:
        logger.warning(
            "Unrecognized sort mode '%s', falling back to '%s'",
            sortMode,
            _DEFAULT_SORT,
        )
        key = _DEFAULT_SORT
    return _SORT_MODE_TO_SQL[key]


def _build_fetch_query_template(
    only_wish_list: Optional[str],
    sortOrder: Optional[str],
    has_limit: bool,
    has_skip: bool,
    is_search: bool,
) -> str:
    param_idx = 1
    conditions = ["users.username = $1"]

    if only_wish_list == "true":
        conditions.append("NOT (inv.is_wish IS NULL OR inv.is_wish = FALSE)")
    else:
        conditions.append("(inv.is_wish IS NULL OR inv.is_wish = FALSE)")

    if is_search:
        param_idx += 1
        conditions.append(
            f"(it.item_name ILIKE ${param_idx} OR it.shortened_name ILIKE ${param_idx} OR COALESCE(classify.class, '') ILIKE ${param_idx})"
        )

    where_clause = f"WHERE {' AND '.join(conditions)}"

    limit_clause = f"LIMIT ${param_idx + 1}" if has_limit else "LIMIT 1000"
    if has_limit:
        param_idx += 1

    offset_clause = f"OFFSET ${param_idx + 1}" if has_skip else ""

    sort_sql = convertSortToSql(sortOrder)

    # For array_agg ordering we always want created_at DESC inside the aggregate
    sql = (
        f"SELECT "
        f"  inv.item_id AS ean, "
        f"  SUM(inv.count) AS count, "
        f"  it.shortened_name AS shortened_name, "
        f"  it.item_name, "
        f"  classify.class, "
        f"  it.image_url, "
        f"  array_agg(inv.created_at ORDER BY inv.created_at DESC NULLS LAST) AS perish_dates "
        f"FROM inventory inv "
        f"JOIN items it ON it.item_id = inv.item_id "
        f"JOIN users ON users.user_id = inv.user_id "
        f"LEFT JOIN item_classification classify ON classify.item_id = inv.item_id "
        f"{where_clause} "
        f"GROUP BY inv.item_id, it.item_name, it.shortened_name, classify.class, it.image_url "
        f"{sort_sql} "
        f"{limit_clause} "
        f"{offset_clause}"
    ).strip()

    return sql

def build_fetch_query(
    username: str | None,
    only_wish_list: Optional[str] = None,
    sortOrder: Optional[str] = None,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    searchQuery: Optional[str] = None,
) -> tuple[str, list]:
    params = []
    
    if not username:
        raise ValueError(f"the username param has to be not none")
    username = username.strip()
    
    if not username or username == "": 
        raise Exception(f"this operation does need a specific username and not {username}")
    params.append(username)
        
    if searchQuery and searchQuery.strip():
        params.append(f"%{searchQuery.strip()}%")

    has_limit = limit is not None and limit > 0
    has_skip = skip is not None and skip > 0
    if has_limit:
        params.append(limit)
    if has_skip:
        params.append(skip)

    query = _build_fetch_query_template(
        only_wish_list=only_wish_list,
        sortOrder=sortOrder,
        has_limit=has_limit,
        has_skip=has_skip,
        is_search=bool(searchQuery and searchQuery.strip()),
    )
    
    return query, params
