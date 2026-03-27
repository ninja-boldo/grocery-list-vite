# grocery-list

A **self-hosted grocery list web application** with barcode scanning, voice transcription, and geolocation-based supermarket mapping.

Live instance: https://boldo.ddns.net

![demo](other/docs/demo.gif)

---

## Key Features

- Grocery list with quantity tracking
- Barcode / EAN scanning via camera
- Voice transcription for hands-free item entry
- Supermarket map based on current location
- Item catalogue with images
- Optional mobile scanner app (React Native)

---

## Tech Stack

| Layer              | Technology                              |
| ------------------ | --------------------------------------- |
| Frontend           | React 19 + TypeScript + Vite + Tailwind |
| Backend            | FastAPI (Python)                        |
| Database           | PostgreSQL                              |
| AI / Transcription | Groq Whisper API                        |
| Infra              | Docker + nginx                          |
| Mobile             | React Native (Expo)                     |

---

## Architecture
```
React (Client)
      |
      v
nginx reverse proxy
      |
      v
FastAPI backend
      |
      v
PostgreSQL

Background services
- image fetch worker
- transcription service
- optional local AI inference
```

The project is designed to run **fully self-hosted** on a small VPS.

---

## Database Schema

![Database_schema](other/docs/schema.png)

---

## Deployment

The production instance runs on a single VPS using Docker containers.

Services include:

- nginx reverse proxy
- FastAPI backend
- PostgreSQL database
- background workers
- optional local AI inference

The system prioritizes **low hosting cost and simplicity** over large cloud infrastructure.

---

## Running locally
```bash
git clone https://github.com/ninja-boldo/grocery-list-runner
cd grocery-list-runner

cp .env.example .env
docker compose up -d
```

The application will then be available at:
```
http://localhost
```

---

## Third-Party Data & Licenses

<details>
<summary><strong>Attributions & Usage Policies</strong></summary>

This app makes use of open data from several third-party sources. This section is a rough overview — if you plan to self-host this application, please review the original source licenses and usage policies directly and form your own assessment of compliance for your use case.

---

### OpenStreetMap & Geofabrik

- **Used for:** Supermarket location data
- **Source:** [download.geofabrik.de](https://download.geofabrik.de/)
- **Upstream license:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- **Note:** © OpenStreetMap contributors

The bundled supermarket dataset (`europe-supermarkets.parquet`) is derived from data published by [Geofabrik](https://download.geofabrik.de/), which is itself derived from OpenStreetMap. The ODbL applies to this file. This project follows [Geofabrik's usage policy](https://www.geofabrik.de/geofabrik/openstreetmap.html) — if that policy misrepresents the ODbL, that is on Geofabrik. Any redistribution or derivative works must comply with the ODbL terms.

---

### Photon (Komoot)

- **Used for:** Geocoding (address → coordinates)
- **Source:** [photon.komoot.io](https://photon.komoot.io)
- **Underlying license:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/) (OSM data)
- **Usage policy:** [komoot.com/terms](https://www.komoot.com/terms)
- **Note:** Geocoding by Photon / Komoot

The public Photon API is operated by Komoot and subject to their usage policy. If you self-host this app at any meaningful scale, consider running your own Photon instance.

---

### Open Food Facts

- **Used for:** Product information, EAN barcodes, nutritional data, product images
- **Source:** [world.openfoodfacts.org](https://world.openfoodfacts.org)
- **License:** [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- **Usage policy:** [world.openfoodfacts.org/terms-of-use](https://world.openfoodfacts.org/terms-of-use)
- **Note:** Product data from Open Food Facts

---

### Note for self-hosters

If you run your own instance of this app, you are responsible for ensuring your usage of all third-party data and APIs complies with their respective licenses and usage policies. The above is only a high-level summary — please read the original terms at the links provided and review the source code for the full picture of how each data source is used.

</details>