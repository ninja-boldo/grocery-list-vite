import duckdb

DB_PATH = "data/openfoodfacts.db"

con = duckdb.connect(DB_PATH)

# # Create schema if needed
# con.execute("CREATE SCHEMA IF NOT EXISTS main")


# con.execute("DROP TABLE IF EXISTS main.item_list")


# con.execute("""
# CREATE TABLE IF NOT EXISTS item_list (
#     ean string,
#     item_name string,
#     subgroups string,
# )
# """)


print(con.execute("select * from main.item_list").df())
con.close()
