#!/usr/bin/env bash
set -e

# --- CONFIG ---
PG_VERSION=15          # Change if you want a different version
DB_USER="admin"
DB_PASS="torvalds"
DB_NAME="postgresdb"
CSV_FILE="openfoodfacts.csv"   # Optional CSV to import
TABLE_NAME="food_data"           # Table to import CSV into

# --- 1. Install PostgreSQL ---
echo "Installing PostgreSQL..."
sudo apt update
sudo apt install -y postgresql postgresql-contrib

# --- 2. Ensure PostgreSQL is running ---
sudo systemctl enable postgresql
sudo systemctl start postgresql

# --- 3. Create user and database ---
echo "Creating database and user..."
sudo -u postgres psql <<EOF
DO \$\$
BEGIN
   IF NOT EXISTS (
       SELECT FROM pg_roles WHERE rolname = '${DB_USER}'
   ) THEN
      CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
   END IF;
END
\$\$;

CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
EOF


# --- 5. Import CSV if provided ---
if [ -f "$CSV_FILE" ]; then
    echo "Importing CSV file: $CSV_FILE into table $TABLE_NAME"
    sudo -u postgres psql -d "$DB_NAME" <<EOF
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
    id SERIAL PRIMARY KEY,
    name TEXT,
    col2 TEXT,
    col3 TEXT
);
\copy ${TABLE_NAME}(col1, col2, col3) FROM '${CSV_FILE}' CSV HEADER;
EOF
fi

echo "PostgreSQL installation and setup complete!"
echo "Database: ${DB_NAME}"
echo "User: ${DB_USER}"
echo "Password: ${DB_PASS}"
