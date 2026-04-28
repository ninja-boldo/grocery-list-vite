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


def build_fetch_query(
    username: str | None,
    only_wish_list: Optional[str] = None,
    sortOrder: Optional[str] = None,
    skip: Optional[int] = None,
    limit: Optional[int] = None,
    searchQuery: Optional[str] = None,
) -> tuple[str, list]:
    if not username or not username.strip():
        raise ValueError("username must be a non-empty string")

    username = username.strip()
    is_wish = only_wish_list == "true"
    is_search = bool(searchQuery and searchQuery.strip())

    params: list = [username]  # $1
    param_idx = 1

    # --- WHERE ---
    conditions = ["users.username = $1"]

    if is_wish:
        conditions.append("inv.is_wish = TRUE")
    else:
        conditions.append("(inv.is_wish IS NULL OR inv.is_wish = FALSE)")

    if is_search:
        param_idx += 1
        search_idx = param_idx
        params.append(f"%{searchQuery.strip()}%")  # type: ignore
        conditions.append(
            f"(it.item_name ILIKE ${search_idx}"
            f" OR it.shortend_name ILIKE ${search_idx}"
            f" OR COALESCE(classify.class, '') ILIKE ${search_idx}"
            f" OR it.item_id ILIKE ${search_idx})"
        )

    where_clause = "WHERE " + " AND ".join(conditions)

    # --- LIMIT / OFFSET ---
    has_limit = limit is not None and limit > 0
    has_skip = skip is not None and skip > 0

    if has_limit:
        param_idx += 1
        limit_clause = f"LIMIT ${param_idx}"
        params.append(limit)
    else:
        limit_clause = "LIMIT 1000"

    if has_skip:
        param_idx += 1
        offset_clause = f"OFFSET ${param_idx}"
        params.append(skip)
    else:
        offset_clause = ""

    sort_sql = convertSortToSql(sortOrder)

    # --- LATERAL wish join ---
    if is_wish:
        wished_join = """
        LEFT JOIN LATERAL (
            SELECT
                jsonb_agg(
                    jsonb_build_object(
                        'item_name', linked_items.item_name,
                        'count',     COALESCE(user_inv.count, 0)
                    )
                ) AS mapped_items
            FROM wish_mapping wish
            JOIN items linked_items ON linked_items.item_id = wish.item_id
            LEFT JOIN inventory user_inv
                ON user_inv.item_id = wish.item_id
                AND user_inv.user_id = (
                    SELECT user_id FROM users WHERE username = $1
                )
            WHERE wish.wish_item_id = it.item_id
        ) wished ON TRUE"""
        extra_select = ",\n    wished.mapped_items"
        extra_group_by = ",\n    wished.mapped_items"
    else:
        wished_join = ""
        extra_select = ""
        extra_group_by = ""

    sql = f"""
        SELECT
            inv.item_id          AS ean,
            SUM(inv.count)       AS count,
            it.shortend_name,
            it.item_name,
            classify.class,
            it.image_url,
            it.amount,
            it.unit,
            it.days_to_expire as expiry_days,
            array_agg(inv.created_at ORDER BY inv.created_at DESC NULLS LAST) AS perish_dates{extra_select}
        FROM inventory inv
        JOIN items it
            ON it.item_id = inv.item_id
        JOIN users
            ON users.user_id = inv.user_id
        LEFT JOIN item_classification classify
            ON classify.item_id = inv.item_id
        {wished_join}
        {where_clause}
        GROUP BY
            inv.item_id,
            it.item_name,
            it.shortend_name,
            classify.class,
            it.amount,
            it.unit,
            it.image_url{extra_group_by},
            it.days_to_expire
        {sort_sql}
        {limit_clause}
        {offset_clause}
        """.strip()

    return sql, params
