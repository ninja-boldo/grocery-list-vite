DATABASE_SCHEMA = [
    """CREATE SCHEMA IF NOT EXISTS "public";""",
    """CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" SERIAL NOT NULL,
    "password_hash" TEXT,
    "username" TEXT,
    PRIMARY KEY ("user_id")
);""",
    """CREATE INDEX "users_users_index_0" ON "public"."users" ("user_id", "username", "password_hash");""",
    """CREATE TABLE IF NOT EXISTS "public"."supermarkets" (
    "supermarket_id" SERIAL NOT NULL,
    "name" TEXT,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "chain" TEXT,
    "opening_periods" TEXT,
    "address" TEXT,
    PRIMARY KEY ("supermarket_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."items" (
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "image_url" TEXT,
    "shortend_name" TEXT,
    "last_checked_at" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    "amount" INT,
    "unit" TEXT,
    "is_golden_record" BOOLEAN DEFAULT FALSE,
    "days_to_expire" INT,
    PRIMARY KEY ("item_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "ingredient_id" SERIAL NOT NULL,
    "amount" INT,
    "unit" TEXT,
    "name" TEXT,
    PRIMARY KEY ("ingredient_id"),
    CONSTRAINT "ingredients_name_amount_unit_key" UNIQUE ("name", "amount", "unit")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."ingredient_item_map" (
    "ingredient_id" INT NOT NULL,
    "item_id" TEXT NOT NULL,
    "missing_quantity" DOUBLE PRECISION,
    PRIMARY KEY ("ingredient_id", "item_id"),
    CONSTRAINT "fk_ingredient_item_map_item_id_items_item_id"
        FOREIGN KEY ("item_id") REFERENCES "public"."items" ("item_id"),
    CONSTRAINT "fk_ingredient_item_map_ingredient_id_ingredients_ingredient_id"
        FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients" ("ingredient_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "recipe_id" SERIAL NOT NULL,
    "user_id" INT,
    "base_time" INT,
    "default_portions" INT,
    "emoji" TEXT,
    "tags" TEXT[] NOT NULL,
    "steps" TEXT[],
    "name" TEXT NOT NULL,
    PRIMARY KEY ("recipe_id"),
    CONSTRAINT "fk_recipes_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE UNIQUE INDEX "recipes_recipe_id_unique" ON "public"."recipes" ("recipe_id");""",
    """CREATE TABLE IF NOT EXISTS "public"."recipe_ingredient_map" (
    "recipe_id" INT NOT NULL,
    "ingredient_id" INT NOT NULL,
    "count" INT,
    PRIMARY KEY ("recipe_id", "ingredient_id"),
    CONSTRAINT "fk_recipe_ingredient_map_recipe_id_recipes_recipe_id"
        FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes" ("recipe_id"),
    CONSTRAINT "fk_recipe_ingredient_map_ingredient_id_ingredients_ingredient_id"
        FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients" ("ingredient_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."inventory" (
    "id" SERIAL NOT NULL,
    "item_id" TEXT,
    "user_id" INT,
    "count" INT,
    "is_wish" BOOLEAN,
    "created_at" TIMESTAMP,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_inventory_item_id_items_item_id"
        FOREIGN KEY ("item_id") REFERENCES "public"."items" ("item_id"),
    CONSTRAINT "fk_inventory_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE INDEX "inventory_inventory_index_0" ON "public"."inventory" ("user_id", "is_wish", "created_at", "item_id", "id");""",
    """CREATE TABLE IF NOT EXISTS "public"."item_classification" (
    "item_id" TEXT NOT NULL,
    "categories_off" TEXT,
    "class" TEXT,
    PRIMARY KEY ("item_id"),
    CONSTRAINT "fk_item_classification_item_id_items_item_id"
        FOREIGN KEY ("item_id") REFERENCES "public"."items" ("item_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."classification_need" (
    "user_id" INT NOT NULL UNIQUE,
    "classification_kind" TEXT NOT NULL,
    "id" SERIAL NOT NULL,
    PRIMARY KEY ("id"),
    CONSTRAINT "fk_classification_need_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."wish_mapping" (
    "item_id" TEXT NOT NULL,
    "wish_item_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matched" BOOLEAN,
    PRIMARY KEY ("item_id", "wish_item_id"),
    CONSTRAINT "fk_wish_mapping_item_id_items_item_id"
        FOREIGN KEY ("item_id") REFERENCES "public"."items" ("item_id"),
    CONSTRAINT "fk_wish_mapping_wish_item_id_items_item_id"
        FOREIGN KEY ("wish_item_id") REFERENCES "public"."items" ("item_id")
);""",
    """CREATE INDEX "wish_mapping_idx_wish_mapping_item_id" ON "public"."wish_mapping" ("item_id");""",
    """CREATE INDEX "wish_mapping_idx_wish_mapping_wish_item_id" ON "public"."wish_mapping" ("wish_item_id");""",
    """CREATE TABLE IF NOT EXISTS "public"."grocery_offers" (
    "offer_id" SERIAL NOT NULL,
    "added_at" TIMESTAMP,
    "item_name" TEXT,
    "original_price" DOUBLE PRECISION,
    "offer_price" DOUBLE PRECISION,
    "supermarket_id" INT,
    "shortened_name" TEXT,
    "weight_g" TEXT,
    "volume_ml" TEXT,
    "is_app_offer" BOOLEAN,
    PRIMARY KEY ("offer_id"),
    CONSTRAINT "fk_grocery_offers_supermarket_id_supermarkets_supermarket_id"
        FOREIGN KEY ("supermarket_id") REFERENCES "public"."supermarkets" ("supermarket_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."planner_settings" (
    "user_id" INT NOT NULL,
    "fast_day_meal_minutes" INT,
    "normal_day_meal_minutes" INT,
    "default_servings" INT,
    PRIMARY KEY ("user_id"),
    CONSTRAINT "fk_planner_settings_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."day_settings" (
    "user_id" INT NOT NULL,
    "day" TEXT NOT NULL,
    "day_meal_time_type" TEXT NOT NULL,
    "breakfast_blocked" BOOLEAN NOT NULL,
    "lunch_blocked" BOOLEAN NOT NULL,
    "dinner_blocked" BOOLEAN,
    PRIMARY KEY ("user_id", "day"),
    CONSTRAINT "fk_day_settings_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."meal_slots" (
    "recipe_id" INT NOT NULL,
    "meal_type" TEXT,
    "servings" INT,
    "user_id" INT NOT NULL,
    "day" TEXT,
    "day_time" TEXT,
    PRIMARY KEY ("recipe_id"),
    CONSTRAINT "fk_meal_slots_recipe_id_recipes_recipe_id"
        FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes" ("recipe_id"),
    CONSTRAINT "fk_meal_slots_user_id_users_user_id"
        FOREIGN KEY ("user_id") REFERENCES "public"."users" ("user_id")
);""",
    """CREATE TABLE IF NOT EXISTS "public"."model_usage" (
    "model" text NOT NULL,
    "provider_url" text NOT NULL,
    "process_name" text NOT NULL,
    "usage_stats" json NOT NULL,
    "timestamp" timestamptz NOT NULL,
    "user_id" int,
    "id" serial NOT NULL,
    PRIMARY KEY ("id")
);""",
    """CONSTRAINT "fk_model_usage_user_id_users_user_id" 
        FOREIGN KEY("user_id") REFERENCES "public"."users"("user_id");""",
]

DATABASE_TABLES = [
    "item_classification",
    "users",
    "supermarkets",
    "inventory",
    "recipes",
    "ingredients",
    "ingredient_item_map",
    "items",
    "grocery_offers",
    "wish_mapping",
    "meal_slots",
    "day_settings",
    "planner_settings",
]
