# API Endpoints

## Core Endpoints

| Method | Path                 | Auth | Purpose              |
| ------ | -------------------- | ---- | -------------------- |
| `POST` | `/token`             | -    | Login, get JWT       |
| `POST` | `/change_password`   | ✓    | Change password      |
| `GET`  | `/fetch_items`       | ✓    | List inventory items |
| `POST` | `/add_ean_to_list/`  | ✓    | Add item by EAN      |
| `POST` | `/add_fetched_items` | ✓    | Batch add items      |
| `GET`  | `/recipes`           | ✓    | Get user recipes     |
| `POST` | `/recipes`           | ✓    | Create recipe        |
| `GET`  | `/recipes/{id}`      | ✓    | Get single recipe    |

## Week Plan

| Method | Path         | Auth | Purpose                 |
| ------ | ------------ | ---- | ----------------------- |
| `GET`  | `/week_plan` | ✓    | Get plan + settings     |
| `POST` | `/week_plan` | ✓    | Replace plan + settings |

## Supermarkets

| Method | Path                      | Auth  | Purpose          |
| ------ | ------------------------- | ----- | ---------------- |
| `GET`  | `/get_supermarkets_close` | ✓     | Geo search       |
| `POST` | `/add_new_market`         | ✓     | Add supermarket  |
| `GET`  | `/get_catalogue_offers`   | ✓     | Get offers       |
| `POST` | `/post_catalogue`         | admin | Upload catalogue |

## Transcription (ML)

| Method | Path          | Auth | Purpose      |
| ------ | ------------- | ---- | ------------ |
| `POST` | `/transcribe` | ✓    | Audio → item |

## Infrastructure

| Method | Path      | Purpose      |
| ------ | --------- | ------------ |
| `GET`  | `/health` | Health check |

## Auth Middleware

Middleware checks `Authorization: Bearer <token>` header on `auth_needed_endpoints`. Token verified via `verify_token()` in `password_helper.py`.

Admin-only endpoints (`/post_catalogue`) checked against `ADMIN_USERNAMES` env var.

## See Also

[[server-infrastructure]] - Overview
[[api-helpers]] - Business logic layer
