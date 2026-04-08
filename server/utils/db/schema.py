DATABASE_SCHEMA = [
    # Schema
    """CREATE SCHEMA IF NOT EXISTS "public";""",
    # users
    """CREATE TABLE IF NOT EXISTS "public"."users" (
    "user_id" SERIAL NOT NULL,
    "password_hash" TEXT,
    "username" TEXT,
    PRIMARY KEY("user_id")
);""",
    """CREATE INDEX "users_users_index_0"
ON "public"."users" ("user_id", "username", "password_hash");""",
    # items
    """CREATE TABLE IF NOT EXISTS "public"."items" (
    "item_id" TEXT NOT NULL,
    "item_name" TEXT NOT NULL,
    "image_url" TEXT,
    "shortened_name" TEXT,
    "last_checked_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    "amount" INT DEFAULT NULL,
    "unit" TEXT DEFAULT NULL,
    "is_golden_record" BOOLEAN DEFAULT FALSE,
    PRIMARY KEY("item_id")
);""",
    # wish_mapping
    """CREATE TABLE IF NOT EXISTS "public"."wish_mapping" (
    "item_id" TEXT NOT NULL,
    "wish_item_id" TEXT NOT NULL,
    "wish_list_hash" TEXT NOT NULL,
    "pantry_list_hash" TEXT NOT NULL,
    PRIMARY KEY("item_id", "wish_list_hash")
);""",
    # inventory
    """CREATE TABLE IF NOT EXISTS "public"."inventory" (
    "id" SERIAL NOT NULL,
    "item_id" TEXT,
    "user_id" INT,
    "count" INT,
    "is_wish" BOOLEAN,
    "created_at" TIMESTAMPTZ,
    PRIMARY KEY("id")
);""",
    """CREATE INDEX "inventory_inventory_index_0"
ON "public"."inventory" ("user_id", "is_wish", "created_at", "item_id", "id");""",
    # item_classification
    """CREATE TABLE IF NOT EXISTS "public"."item_classification" (
    "item_id" TEXT NOT NULL,
    "categories_off" TEXT,
    "class" TEXT,
    "mapped_wishes" TEXT,
    PRIMARY KEY("item_id")
);""",
    # ingredients
    """CREATE TABLE IF NOT EXISTS "public"."ingredients" (
    "ingredient_id" SERIAL NOT NULL,
    "amount" INT,
    "unit" INT,
    "name" INT,
    PRIMARY KEY("ingredient_id")
);""",
    # supermarkets
    """CREATE TABLE IF NOT EXISTS "public"."supermarkets" (
    "supermarket_id" SERIAL NOT NULL,
    "name" TEXT,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "chain" TEXT,
    "opening_periods" TEXT,
    "address" TEXT,
    PRIMARY KEY("supermarket_id")
);""",
    """CREATE INDEX "supermarkets_supermarkets_index_0"
ON "public"."supermarkets" ("supermarket_id", "name", "longitude", "latitude", "chain", "opening_periods", "address");""",
    # recipes
    """CREATE TABLE IF NOT EXISTS "public"."recipes" (
    "recipe_id" SERIAL NOT NULL,
    "user_id" INT,
    "base_time" INT,
    "default_portions" INT,
    "emoji" TEXT,
    "tags" TEXT[],
    "steps" TEXT[],
    PRIMARY KEY("recipe_id")
);""",
    # recipe_ingredient_map
    """CREATE TABLE IF NOT EXISTS "public"."recipe_ingredient_map" (
    "recipe_id" INT NOT NULL,
    "ingredient_id" INT NOT NULL,
    "count" INT,
    PRIMARY KEY("recipe_id", "ingredient_id")
);""",
    # grocery_offers
    """CREATE TABLE IF NOT EXISTS "public"."grocery_offers" (
    "offer_id" SERIAL NOT NULL,
    "added_at" TIMESTAMPTZ,
    "item_name" TEXT,
    "original_price" DOUBLE PRECISION,
    "offer_price" DOUBLE PRECISION,
    "supermarket_id" INT,
    "shortened_name" TEXT,
    "weight_g" TEXT,
    "volume_ml" TEXT,
    "is_app_offer" BOOLEAN,
    PRIMARY KEY("offer_id")
);""",
    # Foreign keys
    """ALTER TABLE "public"."grocery_offers"
ADD CONSTRAINT "fk_grocery_offers_supermarket_id_supermarkets_supermarket_id"
FOREIGN KEY("supermarket_id") REFERENCES "public"."supermarkets"("supermarket_id");""",
    """ALTER TABLE "public"."inventory"
ADD CONSTRAINT "fk_inventory_item_id_items_item_id"
FOREIGN KEY("item_id") REFERENCES "public"."items"("item_id");""",
    """ALTER TABLE "public"."inventory"
ADD CONSTRAINT "fk_inventory_user_id_users_user_id",
FOREIGN KEY("user_id") REFERENCES "public"."users"("user_id");""",
]

DATABASE_TABLES = [
    "item_classification",
    "users",
    "supermarkets",
    "inventory",
    "recipes",
    "ingredients",
    "items",
    "grocery_offers",
    "wish_mapping",
]
