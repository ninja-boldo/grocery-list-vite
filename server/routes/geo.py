import os
import logging
import asyncio
import aiofiles
import uuid
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Query, Request, HTTPException, UploadFile, Form, status

from utils.api_helpers import (
    convertAddressToCoordinates,
    isAddSupermarketBodyValid,
    isCatolgueBodyValid,
    classifyCatalogue,
    obtainSupermarketId,
    sanitizeDeprecationDays,
)
from utils.types_custom import AddSupermarketRequest, AddCatalogueRequest

router = APIRouter(prefix="", tags=["geo"])


@router.get("/get_catalogue_offers")
async def get_offers(
    request: Request,
    longitude: float,
    latitude: float,
    DeprecationDays: Optional[int] = None,
):
    logger = logging.getLogger("fastapi-logger")
    try:
        DeprecationDays = sanitizeDeprecationDays(DeprecationDays, default=30)
        oldestValidTs = dt.datetime.now() - dt.timedelta(days=DeprecationDays)

        async with request.app.state.pool.acquire() as con:
            supermarketId = await obtainSupermarketId(
                con, AddCatalogueRequest(longitude=longitude, latitude=latitude)
            )
            if not isinstance(supermarketId, int):
                raise ValueError(f"supermarket id mapping failed: {supermarketId}")

            rows = await con.fetch(
                """select item_name, shortend_name, added_at, original_price, offer_price,
                   is_app_offer, weight_g, volume_ml
                   from grocery_offers where supermarket_id = $1 and added_at >= $2""",
                supermarketId,
                oldestValidTs,
            )

        items = [
            {
                "name": row.get("item_name"),
                "shortened_name": row.get("shortend_name"),
                "weight_g": row.get("weight_g"),
                "volume_ml": row.get("volume_ml"),
                "normal_price": row.get("original_price"),
                "discount_price": row.get("offer_price"),
                "is_app_offer": row.get("is_app_offer"),
            }
            for row in rows
        ]
        return {"items": items, "count": len(items)}

    except Exception as e:
        logger.error(f"get_catalogue_offers error: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch items")


@router.post("/add_new_market")
async def post_market(request: Request, body: AddSupermarketRequest):
    logger = logging.getLogger("fastapi-logger")
    try:
        if not body.name or body.name.strip() == "":
            return {
                "status": "error",
                "message": "name is required",
                "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
            }

        if not isAddSupermarketBodyValid(body):
            return {
                "status": "error",
                "message": "Body requires either (latitude + longitude) or (address + city/postcode)",
                "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
            }

        resolved_lat = body.latitude
        resolved_lon = body.longitude
        resolved_address = body.address
        resolved_city = body.city
        geocode_source = "request_coordinates"

        if resolved_lat is None or resolved_lon is None:
            if not body.address or not body.city:
                return {
                    "status": "error",
                    "message": "address and city are required when coordinates are missing",
                    "code": status.HTTP_422_UNPROCESSABLE_CONTENT,
                }

            result = convertAddressToCoordinates(body.address, body.city)
            if result.get("status") == "error":
                return {
                    "status": "error",
                    "message": result.get("message", "Failed to geocode address"),
                    "code": result.get("code", "500"),
                }

            resolved_lat = result.get("latitude")
            resolved_lon = result.get("longitude")
            resolved_address = result.get("address") or body.address
            resolved_city = result.get("city") or body.city
            geocode_source = "photon"

        if resolved_lat is None or resolved_lon is None:
            return {
                "status": "error",
                "message": "Could not resolve market coordinates",
                "code": "500",
            }

        async with request.app.state.pool.acquire() as con:
            row = await con.fetchrow(
                """insert into supermarkets(name, longitude, latitude, address, chain)
                   values($1, $2, $3, $4, $5)
                   returning supermarket_id, name, longitude, latitude, address, chain""",
                body.name.strip(),
                float(resolved_lon),
                float(resolved_lat),
                resolved_address,
                body.category,
            )

        return {
            "status": "success",
            "detail": "Backend received market payload and stored it successfully",
            "message": "Supermarket added to database",
            "geocode_source": geocode_source,
            "market": dict(row) if row else None,
            "input": {
                "name": body.name,
                "address": body.address,
                "city": resolved_city,
                "category": body.category,
            },
        }

    except Exception as e:
        logger.error(f"add_new_market failed: {e}")
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@router.post("/post_catalogue")
async def post_catalogue(
    request: Request,
    catalogue: UploadFile,
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    lat: Optional[float] = Form(None),
    lon: Optional[float] = Form(None),
    name: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    categories: Optional[str] = Form(None),
    city: Optional[str] = Form(None),
    postcode: Optional[str] = Form(None),
):
    logger = logging.getLogger("fastapi-logger")

    if latitude is not None and lat is not None and latitude != lat:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Provide either latitude or lat, not conflicting values",
        )
    if longitude is not None and lon is not None and longitude != lon:
        raise HTTPException(
            status_code=400,
            detail="Provide either longitude or lon, not conflicting values",
        )

    resolved_lat = latitude if latitude is not None else lat
    resolved_lon = longitude if longitude is not None else lon

    payload = {
        "latitude": resolved_lat,
        "longitude": resolved_lon,
        "name": name,
        "address": address,
        "categories": categories,
        "city": city,
        "postcode": postcode,
    }

    try:
        body = AddCatalogueRequest.model_validate(payload)
    except Exception as e:
        raise HTTPException(
            status_code=422, detail=f"Invalid catalogue metadata: {e}"
        ) from e

    if not isCatolgueBodyValid(body):
        raise HTTPException(
            status_code=400,
            detail="you havent provided enough positional data for it to be mapped to a market",
        )

    if not catalogue.filename:
        raise HTTPException(status_code=400, detail="you havent uploaded a valid file")

    try:
        upload_dir = "server/supermarkets/uploads"
        os.makedirs(upload_dir, exist_ok=True)

        ALLOWED = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png"}
        if catalogue.content_type not in ALLOWED:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {catalogue.content_type}",
            )

        ext = ALLOWED[catalogue.content_type]
        unique_filename = (
            f"{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4()}{ext}"
        )
        file_path = os.path.join(upload_dir, unique_filename)

        contents = await catalogue.read()
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(contents)

        asyncio.create_task(
            classifyCatalogue(
                request.app.state.pool,
                request.app.state.catalogueClassifier,
                body,
                file_path,
                logger,
            )
        )

        return {
            "status": "ok",
            "code": 202,
            "detail": "catalogue accepted and queued for classification",
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"failed to process catalogue upload: {e}"
        ) from e


@router.get("/get_supermarkets_close")
async def get_supermarkets_close(
    request: Request,
    lat: Optional[float] = Query(None),
    lon: Optional[float] = Query(None),
    radius_meters: int = Query(2000, ge=100, le=50000),
    chains: Optional[list[str]] = Query(None),
):
    if lat is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lat")
    if lon is None:
        raise HTTPException(status_code=400, detail="Missing required parameter: lon")
    if not -90 <= lat <= 90:
        raise HTTPException(
            status_code=400, detail="Latitude must be between -90 and 90"
        )
    if not -180 <= lon <= 180:
        raise HTTPException(
            status_code=400, detail="Longitude must be between -180 and 180"
        )

    try:
        results = []
        async with request.app.state.pool.acquire() as con:
            rows = await con.fetch(
                """WITH params AS (
                    SELECT $1::float AS latitude, $2::float AS longitude, $3::float AS radius_m
                )
                SELECT s.*, (
                    6371000 * ACOS(
                        COS(RADIANS(p.latitude)) * COS(RADIANS(s.latitude)) *
                        COS(RADIANS(s.longitude) - RADIANS(p.longitude)) +
                        SIN(RADIANS(p.latitude)) * SIN(RADIANS(s.latitude))
                    )
                ) AS distance_m
                FROM supermarkets s, params p
                WHERE s.latitude BETWEEN p.latitude - (p.radius_m / 111320.0) AND p.latitude + (p.radius_m / 111320.0)
                AND s.longitude BETWEEN p.longitude - (p.radius_m / (111320.0 * COS(RADIANS(p.latitude)))) AND p.longitude + (p.radius_m / (111320.0 * COS(RADIANS(p.latitude))))
                AND (6371000 * ACOS(
                    COS(RADIANS(p.latitude)) * COS(RADIANS(s.latitude)) *
                    COS(RADIANS(s.longitude) - RADIANS(p.longitude)) +
                    SIN(RADIANS(p.latitude)) * SIN(RADIANS(s.latitude))
                )) <= p.radius_m
                ORDER BY distance_m""",
                lat,
                lon,
                radius_meters,
            )

        for row in rows:
            results.append(
                {
                    "name": row.get("name", "Unknown"),
                    "latitude": row.get("latitude"),
                    "longitude": row.get("longitude"),
                    "address": row.get("address"),
                    "opening_hours": row.get("opening_periods"),
                    "brand": row.get("brand"),
                }
            )

        return {"results": results, "count": len(results)}

    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }
