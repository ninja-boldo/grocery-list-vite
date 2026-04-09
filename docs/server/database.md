# Database

## Connection

PostgreSQL via `asyncpg` with connection pooling. Pool settings in `Config`:

```python
DB_POOL_MIN_SIZE = 1
DB_POOL_MAX_SIZE = 5
DB_COMMAND_TIMEOUT = 30
DB_RETRY_ATTEMPTS = 10
DB_RETRY_DELAY = 2.0
```

URL resolved via `Config.get_database_url()` - uses container URL in Docker, localhost otherwise.

## DatabaseManager

Centralized DB operations (`utils/db/dbManager.py`) with automatic retry on transient failures:

| Method | Purpose |
|--------|---------|
| `execute_with_retry()` | Write operations |
| `fetch_with_retry()` | Read many rows |
| `fetchrow_with_retry()` | Read single row |
| `fetchval_with_retry()` | Read single value |

Retry loop catches `asyncpg.PostgresConnectionError` and `asyncpg.InterfaceError`.

## Schema

Initialized via `ensure_schema()` which executes `DATABASE_SCHEMA` commands from `utils/db/schema.py`.

### Key Tables

| Table | Purpose | Key Index |
|-------|---------|-----------|
| `users` | Authentication | `username` |
| `items` | Product catalog | `item_id` (PK) |
| `inventory` | User's grocery items | `(user_id, is_wish)` |
| `item_classification` | Category mappings | `item_id` |
| `recipes` | User recipes | `user_id` |
| `meal_slots` | Weekly meal plan | `(user_id, day)` |
| `day_settings` | Per-day meal settings | `(user_id, day)` |
| `supermarkets` | Geo data | `supermarket_id` |
| `grocery_offers` | Catalogue offers | `supermarket_id` |
| `wish_mapping` | Wish-pantry links | `(item_id, wish_list_hash)` |

## Initialization

On app startup (`init_database`):
1. Ensure schema compliance
2. Load supermarket geo data
3. Create sink label item for wish mapping daemon

## See Also

[[server-infrastructure]] - Parent overview
[[schema]] - Full table definitions