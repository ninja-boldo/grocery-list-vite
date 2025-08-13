import duckdb

DB_PATH = "data/openfoodfacts.db"

con = duckdb.connect(DB_PATH)


# Get all columns in the table
columns = con.execute("""
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'food'
    ORDER BY ordinal_position;
    """).fetchall()

print(columns)

columns = con.execute("""
    SELECT *
    FROM food
    limit 10
    """).fetchall()

print(columns)

con.execute("COPY (SELECT * FROM food) TO 'openfoodfacts.csv' (HEADER, DELIMITER ',');")
con.close()
