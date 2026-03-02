FROM python:3.11-slim-bookworm

WORKDIR /app

# python deps
COPY requirements.txt .
RUN pip install -U pip uv && \
    uv pip install --system -r requirements.txt --no-cache-dir

# copy backend and frontend dist
COPY server /app/server

# copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3030 4040
CMD ["python", "server/server.py"]
