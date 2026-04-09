# API Helpers

Business logic layer (`utils/api_helpers.py`) - called by endpoints in `server.py`.

## Item Operations

### `addItemToInventory(...)`
Main function for adding/removing items:
- Resolves username → user_id
- Handles EAN or manual item names
- For adds (`count >= 1`): creates item, classification, inventory entry
- For removes (`count <= -1`): deletes from inventory
- Fetches product info from OpenFoodFacts API if needed

### `addRecipeToDb(...)`
Creates recipe + ingredients in transaction.

### `handleManualItems(...)`
Creates `manual-<sha1>` item IDs for items without EAN.

## Wish/Pantry Mapping

### `buildWishPantryLists(...)` → `craftWishItemLists(...)`
Builds lists for ML matching:
- Fetches all users' inventory
- Hashes wish lists with `hashListState()`
- Returns `(item_names, wished_lists, item_to_id, hash_per_item)`

## Week Plan

### `replaceWeekPlanForUser(con, weekPlan, uid)`
- Purges existing `meal_slots` for user
- Inserts new meal slots

### `getWeekPlanForUser(con, uid)`
- Fetches meal slots, groups by day

### `replaceWeekSettingsForUser(con, uid, weekSettings)`
- Purges existing `day_settings` for user
- Inserts new day settings

### `getWeekSettingsForUser(con, uid)`
- Fetches all day_settings for user

## Utilities

| Function | Purpose |
|----------|---------|
| `getUsernameFromReq(request)` | Extract + verify JWT |
| `getIdFromUsername(con, username)` | Get user_id |
| `validate_wish_list(value)` | Normalize wish bool |
| `hashListState(wish_list)` | Blake2b hash for list |
| `generateManualItemId(itemName)` | `manual-<sha1>` ID |
| `convertAddressToCoordinates(address, city)` | Photon geocoding |
| `classifyCatalogue(...)` | Catalogue → offers |

## See Also

[[api-endpoints]] - Which endpoints use these
[[server-infrastructure]] - Overall structure