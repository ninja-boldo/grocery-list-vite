# ---------- frontend build ----------
FROM node:20-bookworm-slim AS frontend

ENV DEBIAN_FRONTEND=noninteractive
WORKDIR /app

# system deps
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        git build-essential locales && \
    rm -rf /var/lib/apt/lists/*

RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8

# copy everything first (simpler approach)
COPY . .

# clean install
RUN yarn install --frozen-lockfile

# build frontend
RUN yarn build

# ---------- backend runtime ----------
FROM python:3.11-slim-bookworm

WORKDIR /app

# python deps
COPY requirements.txt .
RUN pip install -U pip uv && \
    uv pip install --system -r requirements.txt

# copy backend and frontend dist
COPY server /app/server
COPY --from=frontend /app/dist /app/dist

# copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3030 4040
CMD ["python", "server/server.py"]
