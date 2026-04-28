# Server Infrastructure

## Overview

FastAPI-based backend service running on port **3030** with PostgreSQL database. Handles grocery list management, recipe planning, supermarket mapping, and ML-powered item classification.

## Architecture

```
                    ┌─────────────────────┐
                    │      FastAPI        │
                    │     (server.py)     │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
    ┌─────▼─────┐      ┌──────▼──────┐     ┌──────▼──────┐
    │  HTTP API  │      │   Daemons   │     │   ML/AI     │
    │ Endpoints  │      │ (background)│     │ Classifiers │
    └─────┬─────┘      └──────┬──────┘     └──────┬──────┘
          │                    │                    │
          └──────────┬─────────┴────────┬───────────┘
                     │                 │
              ┌──────▼──────┐   ┌──────▼──────┐
              │   Database  │   │  External   │
              │   (asyncpg)  │   │   APIs      │
              └─────────────┘   └─────────────┘
```

## Key Components

| Component         | File                       | Purpose                          |
| ----------------- | -------------------------- | -------------------------------- |
| [[server]]        | `server.py`                | Main app, endpoints, lifespan    |
| [[database]]      | `utils/db/`                | Schema, connection pooling       |
| [[api-helpers]]   | `utils/api_helpers.py`     | Business logic helpers           |
| [[query-builder]] | `utils/query_builder.py`   | Dynamic SQL construction         |
| [[auth]]          | `utils/password_helper.py` | JWT authentication               |
| [[types]]         | `utils/types.py`           | Pydantic models                  |
| [[daemons]]       | Background tasks           | Classification, image rescanning |

## Startup

```bash
cd server
python server.py
# or with uvicorn directly:
uvicorn server:app --host 0.0.0.0 --port 3030
```

## Configuration

All settings in `Config` class (`utils/db/dbManager.py`):

- `ENABLE_WHISPER_MODEL_CLOUD` - Groq transcription
- `DB_POOL_MIN_SIZE` / `DB_POOL_MAX_SIZE` - Connection pool
- `ENABLE_LOKI_LOGGING` - Loki integration

## See Also

- [[database]] - PostgreSQL schema and connection management
- [[api-endpoints]] - All HTTP endpoints
- [[daemons]] - Background processing tasks
