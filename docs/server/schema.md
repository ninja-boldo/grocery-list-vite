# Database Schema

## Tables

### `users`

| Column          | Type   | Notes  |
| --------------- | ------ | ------ |
| `user_id`       | serial | PK     |
| `username`      | text   | unique |
| `password_hash` | text   | bcrypt |

### `items`

| Column             | Type        | Notes                       |
| ------------------ | ----------- | --------------------------- |
| `item_id`          | text        | PK (EAN or `manual-<sha1>`) |
| `item_name`        | text        |                             |
| `image_url`        | text        | OpenFoodFacts URL           |
| `shortened_name`   | text        | ML-generated short name     |
| `last_checked_at`  | timestamptz | For image refresh           |
| `amount`           | int         | Default quantity            |
| `unit`             | text        | e.g., "g", "ml"             |
| `is_golden_record` | boolean     |                             |

**Index:** `(item_id, username, password_hash)` - unusual, possibly unintended

### `inventory`

User's grocery items (many-to-many users↔items).

| Column       | Type        | Notes                        |
| ------------ | ----------- | ---------------------------- |
| `id`         | serial      | PK                           |
| `item_id`    | text        | FK → items.item_id           |
| `user_id`    | int         | FK → users.user_id           |
| `count`      | int         | Number of this item          |
| `is_wish`    | boolean     | True=wish list, False=pantry |
| `created_at` | timestamptz | For sorting                  |

**Index:** `(user_id, is_wish, created_at, item_id, id)`

### `item_classification`

| Column           | Type | Notes                         |
| ---------------- | ---- | ----------------------------- |
| `item_id`        | text | PK, FK → items                |
| `categories_off` | text | JSON array from OpenFoodFacts |
| `class`          | text | ML-generated tags             |
| `mapped_wishes`  | text |                               |

### `meal_slots`

Weekly meal plan entries.

| Column      | Type | Notes             |
| ----------- | ---- | ----------------- |
| `recipe_id` | int  | FK → recipes      |
| `meal_type` | text | e.g., "breakfast" |
| `servings`  | int  |                   |
| `user_id`   | int  | FK → users        |
| `day`       | text | e.g., "monday"    |
| `day_time`  | text | e.g., "breakfast" |

**PK:** `(recipe_id)` - unusual, may cause issues with multiple entries per day

### `day_settings`

Per-day meal planning settings.

| Column               | Type    | Notes                |
| -------------------- | ------- | -------------------- |
| `user_id`            | int     | FK → users           |
| `day`                | text    | e.g., "monday"       |
| `day_meal_time_type` | text    | quick/normal/relaxed |
| `breakfast_blocked`  | boolean |                      |
| `lunch_blocked`      | boolean |                      |
| `dinner_blocked`     | boolean |                      |

**PK:** `(user_id, day)`

### `recipes`

| Column             | Type   | Notes      |
| ------------------ | ------ | ---------- |
| `recipe_id`        | serial | PK         |
| `user_id`          | int    | FK → users |
| `base_time`        | int    | Minutes    |
| `default_portions` | int    |            |
| `emoji`            | text   |            |
| `tags`             | text[] |            |
| `steps`            | text[] |            |

### `recipe_ingredient_map`

| Column          | Type | Notes            |
| --------------- | ---- | ---------------- |
| `recipe_id`     | int  | FK → recipes     |
| `ingredient_id` | int  | FK → ingredients |
| `count`         | int  |                  |

**PK:** `(recipe_id, ingredient_id)`

### `ingredients`

| Column          | Type   | Notes                            |
| --------------- | ------ | -------------------------------- |
| `ingredient_id` | serial | PK                               |
| `amount`        | int    |                                  |
| `unit`          | int    |                                  |
| `name`          | int    | - seems like bug, should be text |

### `supermarkets`

| Column            | Type   | Notes |
| ----------------- | ------ | ----- |
| `supermarket_id`  | serial | PK    |
| `name`            | text   |       |
| `longitude`       | double |       |
| `latitude`        | double |       |
| `chain`           | text   |       |
| `opening_periods` | text   | JSON  |
| `address`         | text   |       |

### `grocery_offers`

| Column           | Type        | Notes             |
| ---------------- | ----------- | ----------------- |
| `offer_id`       | serial      | PK                |
| `item_name`      | text        |                   |
| `original_price` | double      |                   |
| `offer_price`    | double      |                   |
| `supermarket_id` | int         | FK → supermarkets |
| `shortened_name` | text        |                   |
| `weight_g`       | text        |                   |
| `volume_ml`      | text        |                   |
| `is_app_offer`   | boolean     |                   |
| `added_at`       | timestamptz |                   |

### `wish_mapping`

Links pantry items to their wish list equivalents.

| Column             | Type | Notes                         |
| ------------------ | ---- | ----------------------------- |
| `item_id`          | text | FK → items (pantry item)      |
| `wish_item_id`     | text | The wish item it's mapped to  |
| `wish_list_hash`   | text | Hash of the wish list state   |
| `pantry_list_hash` | text | Hash of the pantry list state |

**PK:** `(item_id, wish_list_hash)`

## See Also

[[database]] - Connection management
