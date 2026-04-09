# Daemons

Background tasks running via `asyncio` during app lifespan.

## ClassificationDaemon

Main coordinator, runs every **10 seconds**:

```python
async def classificationDaemon(pool, waitingTime=10.0):
    while True:
        await rescanCategoriesProcess(pool)      # OpenFoodFacts API
        await shortenItemNamesDaemon(pool)        # ML shortening
        await assignTagsTask(pool)               # ML tagging
        await mapItemToWishDaemon(pool)           # Wish-pantry mapping
```

## Daemons

### `shortenItemNamesDaemon`
- Queries items with missing `shortened_name`
- Runs through ML classifier to shorten names
- Updates `items.shortened_name`

### `assignTagsTask`
- Queries inventory items missing classification
- Runs through ML tag assignment
- Updates `item_classification.class`

### `mapItemToWishDaemon`
- Builds wish/pantry lists per user
- Hashes them with `hashListState()`
- If `(wish_hash, pantry_hash)` not in `wish_mapping`, runs ML matching
- Updates `wish_mapping` table

### `rescanImageUrlsDaemon`
- Queries items with stale/missing `image_url`
- Fetches from OpenFoodFacts API
- Updates `items.image_url` and `last_checked_at`

### `rescanCategoriesProcess`
- Queries inventory items missing categories
- Fetches from OpenFoodFacts `/api/v2/product/{ean}?fields=categories_tags`
- Updates `item_classification.categories_off`

## Lifecycle

Started in `lifespan()` context manager:
```python
daemon_tasks.append(asyncio.create_task(classificationDaemon(app.state.pool)))
daemon_tasks.append(asyncio.create_task(rescanImageUrlsDaemon(app.state.pool)))
```

Cancelled gracefully on shutdown via `atexit` handler.

## See Also

[[server-infrastructure]] - Parent overview
[[api-helpers]] - `hashListState()` for list hashing