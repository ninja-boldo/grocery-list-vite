import duckdb

DB_PATH = "data/openfoodfacts.db"
CSV_PATH = "data/en.openfoodfacts.org.products.csv"

con = duckdb.connect(DB_PATH)

# Create schema if needed
con.execute("CREATE SCHEMA IF NOT EXISTS main")

# Create table and import CSV data (replace with actual columns/types or infer automatically)
con.execute("""
CREATE TABLE IF NOT EXISTS food AS
SELECT * FROM read_csv_auto(?)
""", (CSV_PATH,))

con.close()
