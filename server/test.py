import duckdb

DB_PATH = "data/openfoodfacts.db"

con = duckdb.connect(DB_PATH)

# The table you're modifying
table_name = "food"

# Columns you want to keep
keep_columns = {
    "product_name", "code", "quantity", "packaging",
    "brands_en", "categories", "ingredients_text", "energy-kcal_100g"
}

# Get all columns in the table
columns = con.execute(f"""
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = '{table_name}'
    ORDER BY ordinal_position;
    """).fetchall()

all_columns = [row[0] for row in columns]
drop_columns = [col for col in all_columns if col not in keep_columns]

if not drop_columns:
    print("-- No columns to drop.")
else:
    for col in drop_columns:
        # Enclose column names with hyphens in double quotes
        if "-" in col:
            col = f'"{col}"'
        # Execute the ALTER TABLE command for each column
        con.execute(f'ALTER TABLE {table_name} DROP COLUMN {col};')
        print(f'Dropped column: {col}')

con.close()
