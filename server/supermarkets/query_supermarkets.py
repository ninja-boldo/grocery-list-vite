import logging
from pathlib import Path
from typing import Iterator

import asyncpg
import pyarrow.parquet as pq
from shapely import wkb
from shapely.geometry import shape


SUPPORTED_TABLE_NAME = "supermarkets"
SUPERMARKETS_IMPORT_LOCK_ID = 4_236_041
PARQUET_BATCH_SIZE = 2_000
SUPERMARKET_COLUMNS = [
    "latitude",
    "longitude",
    "address",
    "chain",
    "name",
    "opening_periods",
]


def extractAddress(properties: dict) -> str | None:
    street = properties.get("addr:street")
    house_number = properties.get("addr:housenumber")
    postcode = properties.get("addr:postcode")

    first_line = " ".join(str(p).strip() for p in [street, house_number] if p)
    if first_line and postcode:
        return f"{first_line}, {postcode}"
    if first_line:
        return first_line
    if postcode:
        return str(postcode)
    return None


def extractCoords(geometry: dict) -> tuple[float, float]:
    if geometry["type"] == "Point":
        lon, lat = geometry["coordinates"]
    else:
        centroid = shape(geometry).centroid
        lon, lat = centroid.x, centroid.y
    return float(lat), float(lon)


def _normalize_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _extractCoordsFromValue(geometry: object) -> tuple[float, float]:
    if isinstance(geometry, dict):
        return extractCoords(geometry)

    if isinstance(geometry, memoryview):
        geometry = geometry.tobytes()

    if isinstance(geometry, (bytes, bytearray)):
        parsed = wkb.loads(bytes(geometry))
        centroid = parsed.centroid
        lon, lat = centroid.coords[0]
        return float(lat), float(lon)

    raise ValueError(f"Unsupported geometry type: {type(geometry)}")


def _featureToRecord(feature: dict) -> tuple[float, float, str | None, str | None, str | None, str | None] | None:
    geometry = feature.get("geometry")
    properties = feature.get("properties")

    if not isinstance(geometry, dict) or not isinstance(properties, dict):
        return None

    name = _normalize_text(properties.get("name")) or _normalize_text(
        properties.get("brand")
    )
    if name is None:
        return None

    try:
        lat, lon = extractCoords(geometry)
    except Exception:
        return None

    return (
        lat,
        lon,
        extractAddress(properties),
        _normalize_text(properties.get("brand")),
        name,
        _normalize_text(properties.get("opening_hours")),
    )


def _rowToRecord(row: dict) -> tuple[float, float, str | None, str | None, str | None, str | None] | None:
    name = _normalize_text(row.get("name")) or _normalize_text(row.get("brand"))
    if name is None:
        return None

    lat = row.get("latitude")
    lon = row.get("longitude")
    if lat is not None and lon is not None:
        coords = (float(lat), float(lon))
    else:
        geometry = row.get("geometry")
        if geometry is None:
            return None
        try:
            coords = _extractCoordsFromValue(geometry)
        except Exception:
            return None

    return (
        coords[0],
        coords[1],
        extractAddress(row),
        _normalize_text(row.get("brand")),
        name,
        _normalize_text(row.get("opening_hours")),
    )


def iterSupermarketRecordBatches(
    parquetFile: str,
    batchSize: int = PARQUET_BATCH_SIZE,
) -> Iterator[list[tuple[float, float, str | None, str | None, str | None, str | None]]]:
    parquet_path = Path(parquetFile).resolve()
    if not parquet_path.exists():
        raise FileNotFoundError(f"Parquet file not found: {parquet_path}")

    parquet = pq.ParquetFile(parquet_path)
    schema_names = set(parquet.schema_arrow.names)

    if "features" in schema_names:
        for batch in parquet.iter_batches(batch_size=batchSize, columns=["features"]):
            if batch.num_columns == 0:
                continue

            features = batch.column(0).to_pylist()
            records: list[
                tuple[float, float, str | None, str | None, str | None, str | None]
            ] = []
            for feature in features:
                if not isinstance(feature, dict):
                    continue
                parsed = _featureToRecord(feature)
                if parsed is not None:
                    records.append(parsed)
            if records:
                yield records
        return

    projected_columns = [
        column
        for column in [
            "geometry",
            "latitude",
            "longitude",
            "addr:street",
            "addr:housenumber",
            "addr:postcode",
            "brand",
            "name",
            "opening_hours",
        ]
        if column in schema_names
    ]

    if "geometry" not in projected_columns and (
        "latitude" not in projected_columns or "longitude" not in projected_columns
    ):
        raise ValueError(
            "Unsupported parquet schema: missing both geometry and latitude/longitude columns"
        )

    for batch in parquet.iter_batches(batch_size=batchSize, columns=projected_columns):
        records: list[
            tuple[float, float, str | None, str | None, str | None, str | None]
        ] = []
        for row in batch.to_pylist():
            if not isinstance(row, dict):
                continue
            parsed = _rowToRecord(row)
            if parsed is not None:
                records.append(parsed)
        if records:
            yield records


async def handleSupermarketsDbLoad(
    pool: asyncpg.Pool,
    logger: logging.Logger,
    tablename: str = "supermarkets",
    seedFile: str = "server/supermarkets/europe-supermarkets.parquet",
):
    tablename = tablename.strip()
    if tablename != SUPPORTED_TABLE_NAME:
        raise ValueError(f"Unsupported table for import: {tablename}")

    async with pool.acquire() as con:
        await con.fetchval("SELECT pg_advisory_lock($1)", SUPERMARKETS_IMPORT_LOCK_ID)
        try:
            count = int(await con.fetchval(f"SELECT count(*) FROM {tablename}") or 0)
            logger.info(f"{tablename} table has {count} entries")

            if count > 0:
                logger.info("supermarkets already loaded, skipping import")
                return

            inserted = 0
            for recordBatch in iterSupermarketRecordBatches(seedFile):
                await con.copy_records_to_table(
                    tablename,
                    records=recordBatch,
                    columns=SUPERMARKET_COLUMNS,
                )
                inserted += len(recordBatch)
                if inserted % (PARQUET_BATCH_SIZE * 10) == 0:
                    logger.info(f"loaded {inserted} supermarkets so far")

            count = int(await con.fetchval(f"SELECT count(*) FROM {tablename}") or 0)
            logger.info(f"supermarket import complete: inserted={inserted}, total={count}")
        finally:
            await con.fetchval(
                "SELECT pg_advisory_unlock($1)", SUPERMARKETS_IMPORT_LOCK_ID
            )
