import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

df = pd.read_csv("/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv", dtype=str)

table = pa.Table.from_pandas(df)

pq.write_table(table, "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.parquet")