# grocery-list-vite

A self-hosted grocery list web application with barcode scanning, voice transcription, and geolocation-based supermarket mapping.

**Live instance:** [https://boldo.ddns.net](https://boldo.ddns.net) *(temporarily unavailable)*

---

## Features

- Grocery list management with item count tracking
- Barcode / EAN scanning (camera-based)
- Voice transcription for hands-free item entry (via Groq Whisper API)
- Wish list support
- Geolocation-based supermarket mapping (MapLibre GL)
- Item catalogue with image and subgroup support
- Mobile companion app (React Native / Expo) in `native/`

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind CSS v4 |
| Backend | Python FastAPI + asyncpg |
| Database | PostgreSQL |
| AI / Transcription | Groq Whisper API |
| Deployment | Docker + Nginx + docker compose |
| Mobile | React Native (Expo) |

## Getting Started

### With Docker (recommended)

```bash
# Copy and fill in required environment variables
cp .env.example .env   # set GROQ_API_KEY

docker compose up
```

The app is then available at `http://localhost` (nginx) with the API running on port `3030`.

### Local Development

```bash
# Frontend
npm install
npm run dev

# Backend (in a separate terminal)
pip install -r requirements.txt
python server/server.py
```

The Vite dev server proxies `/api/*` requests to `http://localhost:3030` by default (configurable via `VITE_API_BASE_URL`).

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | Yes (when cloud transcription is enabled) | API key for Groq Whisper speech-to-text |
| `VITE_API_BASE_URL` | No | Override backend URL for local dev (default: `http://localhost:3030`) |
| `RUNNING_IN_CONTAINER` | No | Set to `"true"` inside Docker to use container-internal paths |
| `OPENFOODFACTS_CSV_PATH` | No | Path to the OpenFoodFacts CSV for local dev (default: `./openfoodfacts.csv`) |

## Project Structure

```
├── src/                  # React frontend
│   ├── comp/             # UI components (scanning, geo, utils, …)
│   ├── sites/            # Additional pages (WishList, GeoSupermarkets)
│   └── Router.tsx        # Client-side routing
├── server/               # FastAPI backend
│   ├── server.py         # Main application entry point
│   ├── utils/            # DB manager, lookup helpers
│   ├── transcription/    # Whisper transcription helpers
│   └── vector/           # Vector / embedding utilities
├── native/               # React Native (Expo) companion app
│   └── grocery-list-scanner/
├── Dockerfile            # Container image definition
├── compose.yaml          # Multi-service docker compose setup
└── vite.config.ts        # Vite + Tailwind configuration
```

## Notes

- Cloud transcription (`ENABLE_WHISPER_MODEL_CLOUD`) and local Whisper (`ENABLE_WHISPER_MODEL_LOCAL`) are mutually exclusive; enabling both will raise an error at startup.
- Prometheus metrics are exposed by the backend and scraped by the bundled `prometheus` service in `compose.yaml`.
- Loki logging integration is available but disabled by default (`ENABLE_LOKI_LOGGING = False`).
