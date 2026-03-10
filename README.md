# grocery-list

A **self-hosted grocery list web application** with barcode scanning, voice transcription, and geolocation-based supermarket mapping.

Live instance: https://boldo.ddns.net

![demo](demo.gif)

---

## Key Features

* grocery list with quantity tracking
* barcode / EAN scanning via camera
* voice transcription for hands-free item removal
* supermarket map based on current location
* item catalogue with images
* optional mobile scanner app (React Native)

---

## Tech Stack

| Layer       | Technology                              |
| ----------- | --------------------------------------- |
| Frontend    | React 19 + TypeScript + Vite + Tailwind |
| Backend     | FastAPI (Python)                        |
| Database    | PostgreSQL                              |
| AI / Tramscription | Groq Whisper API                        |
| Infra       | Docker + nginx                          |
| Mobile      | React Native (Expo)                     |

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

## Deployment

The production instance runs on a single VPS using Docker containers.

Services include:

* nginx reverse proxy
* FastAPI backend
* PostgreSQL database
* background workers
* optional local AI inference

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
