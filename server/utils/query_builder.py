import logging
from typing import Optional

logger = logging.getLogger(__name__)

_SORT_MODE_TO_SQL: dict[str, str] = {
    "a-z": "ORDER BY it.item_name ASC",
    "z-a": "ORDER BY it.item_name DESC",
    "new-old": "ORDER BY MAX(inv.created_at) DESC NULLS LAST",
    "old-new": "ORDER BY MIN(inv.created_at) ASC NULLS LAST",
}
_DEFAULT_SORT = "new-old"


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
    username_param_idx: int = 1,
    wish_hash_param_idx: Optional[int] = None,
) -> str:
    param_idx = username_param_idx
    conditions = [f"users.username = ${param_idx}"]

    if only_wish_list == "true":
        conditions.append("inv.is_wish = TRUE")
    else:
        conditions.append("(inv.is_wish IS NULL OR inv.is_wish = FALSE)")

    if is_search:
        param_idx += 1
        conditions.append(
            f"(it.item_name ILIKE ${param_idx} OR it.shortend_name ILIKE ${param_idx} OR COALESCE(classify.class, '') ILIKE ${param_idx} OR it.item_id ILIKE ${param_idx})"
        )

    where_clause = f"WHERE {' AND '.join(conditions)}"

    # If wish_hash was injected it occupies one slot before limit/offset.
    # Jump param_idx past it so limit/offset use the right $N.
    if wish_hash_param_idx is not None:
        param_idx = wish_hash_param_idx

    limit_clause = f"LIMIT ${param_idx + 1}" if has_limit else "LIMIT 1000"
    if has_limit:
        param_idx += 1

    offset_clause = f"OFFSET ${param_idx + 1}" if has_skip else ""

    sort_sql = convertSortToSql(sortOrder)

    if only_wish_list == "true":
        # Build optional hash filter for the wish_mapping subquery.
        # When current hashes are provided we restrict to mappings that were
        # produced from the exact same list state, so stale rows are excluded.
        if wish_hash_param_idx is not None:
            # Filter by wish_list_hash only. pantry_list_hash in wish_mapping is
            # overwritten on every daemon upsert (ON CONFLICT on item_id,
            # wish_list_hash), so it cannot be used reliably as a display filter.
            hash_filter = f"AND wm.wish_list_hash = ${wish_hash_param_idx}"
        else:
            hash_filter = ""

        wished_join = f"""
            LEFT JOIN (
            SELECT
                agg.mapped_wish_name,
                jsonb_agg(jsonb_build_object(
                'item_name', agg.item_name,
                'count', agg.total_count
                )) AS mapped_items
            FROM (
                SELECT
                wish_items.item_name AS mapped_wish_name,
                pantry_items.item_name,
                SUM(i.count) AS total_count
                FROM inventory i
                JOIN users u ON u.user_id = i.user_id
                JOIN items pantry_items ON pantry_items.item_id = i.item_id
                JOIN wish_mapping wm ON wm.item_id = i.item_id
                JOIN items wish_items ON wish_items.item_id = wm.wish_item_id
                WHERE (i.is_wish IS NULL OR i.is_wish = FALSE)
                AND wish_items.item_name != 'other'
                AND u.username = $1
                {hash_filter}
                GROUP BY wish_items.item_name, pantry_items.item_name
            ) agg
            GROUP BY agg.mapped_wish_name
            ) wished ON wished.mapped_wish_name = it.item_name"""

        wished_group_by = ", wished.mapped_items"
    else:
        wished_join = ""
        wished_group_by = ""

    extra_cols = ",\n  wished.mapped_items" if only_wish_list == "true" else ""

    sql = (
        f"SELECT"
        f"  inv.item_id AS ean,"
        f"  SUM(inv.count) AS count,"
        f"  it.shortend_name AS shortend_name,"
        f"  it.item_name,"
        f"  classify.class,"
        f"  it.image_url,"
        f"  it.amount as amount,"
        f"  it.unit as unit,"
        f"  array_agg(inv.created_at ORDER BY inv.created_at DESC NULLS LAST) AS perish_dates"
        f"{extra_cols} "
        f"FROM inventory inv "
        f"JOIN items it ON it.item_id = inv.item_id "
        f"JOIN users ON users.user_id = inv.user_id "
        f"LEFT JOIN item_classification classify ON classify.item_id = inv.item_id "
        f"{wished_join} "
        f"{where_clause} "
        f"GROUP BY inv.item_id, it.item_name, it.shortend_name, classify.class, it.amount, it.unit, it.image_url{wished_group_by} "
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
    wish_hash: Optional[str] = None,
) -> tuple[str, list]:
    params: list = []

    if not username:
        raise ValueError("the username param has to be not none")
    username = username.strip()

    if not username or username == "":
        raise Exception(
            f"this operation does need a specific username and not {username}"
        )
    params.append(username)  # $1

    is_search = bool(searchQuery and searchQuery.strip())
    if is_search:
        params.append(f"%{searchQuery.strip()}%")  # type: ignore # $2

    # Inject wish_list_hash for wish-list fetches so stale mappings from old
    # wish-list states are excluded. pantry_list_hash is NOT filtered here —
    # the daemon upserts on (item_id, wish_list_hash) and overwrites
    # pantry_list_hash, making it unreliable as a display-time filter.
    wish_hash_param_idx: Optional[int] = None
    if only_wish_list == "true" and wish_hash is not None:
        wish_hash_param_idx = len(params) + 1
        params.append(wish_hash)

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
        is_search=is_search,
        wish_hash_param_idx=wish_hash_param_idx,
    )

    print(f"running this query: {query}\nwith these params: {params}")

    return query, params
