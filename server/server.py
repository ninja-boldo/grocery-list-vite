import duckdb
import os

# Print the current working directory
print("Current Working Directory:", os.getcwd())

# Create a DuckDB connection to a database file
db_file = 'data/openfoodfacts.db'  # Specify the name of the database file
con = duckdb.connect(db_file)

# Now you can query the table
result = con.execute("PRAGMA table_info('openfoodfacts')").fetchall()



# Print the result
print(result)

# Close the connection
con.close()
