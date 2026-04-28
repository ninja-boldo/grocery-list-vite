#!/bin/bash
set -euo pipefail

REPO="https://github.com/ninja-boldo/grocery-list-runner.git"

# ── 1. Clone repo ────────────────────────────────────────────────────────────
echo "[1/4] Cloning repo..."
git clone "$REPO" _runner_tmp
cp -r _runner_tmp/. .
rm -rf _runner_tmp

# ── 2. Install Docker (if not present) ───────────────────────────────────────
echo "[2/4] Ensuring Docker is installed..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi

# ── 3. Get TLS cert via certbot Docker image (no snap, no host nginx) ────────
echo "[3/4] Obtaining TLS certificate..."

read -rp "Domain (e.g. example.com): " DOMAIN </dev/tty
read -rp "Email for Let's Encrypt:   " EMAIL </dev/tty

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "ERROR: Domain and email cannot be empty."
  exit 1
fi

mkdir -p /etc/letsencrypt

docker run --rm \
  -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/certbot certonly \
    --standalone \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    -d "$DOMAIN"

# ── 4. Start stack ────────────────────────────────────────────────────────────
echo "[4/4] Starting Docker Compose stack..."
docker compose up -d

echo ""
echo "✓ Done. Certs are at /etc/letsencrypt/live/$DOMAIN/"
echo "  Make sure your compose.yaml mounts /etc/letsencrypt into the nginx container."

# ── Renewal cron ─────────────────────────────────────────────────────────────
echo "0 3 * * * root docker run --rm -p 80:80 -v /etc/letsencrypt:/etc/letsencrypt certbot/certbot renew --standalone --quiet && docker compose -f $(pwd)/compose.yaml exec nginx nginx -s reload" > /etc/cron.d/certbot-renew
echo "✓ Renewal cron written to /etc/cron.d/certbot-renew"