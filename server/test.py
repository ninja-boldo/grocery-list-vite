import duckdb

DB_PATH = "data/openfoodfacts.db"

con = duckdb.connect(DB_PATH)

# Create schema if needed
con.execute("CREATE SCHEMA IF NOT EXISTS main")

# Create table and import CSV data (replace with actual columns/types or infer automatically)
con.execute("""
CREATE TABLE IF NOT EXISTS item_list (
    item_name string,
    subgroups string,
)
""")


con.close()
