FROM python:3.11-slim-bookworm

WORKDIR /app

# python deps
COPY requirements.txt .
RUN pip install -U pip uv && \
    uv pip install --system -r requirements.txt --no-cache-dir


# copy backend and frontend dist
COPY server /app/server

# copy start script
COPY start_server.sh /app/start_server.sh
RUN chmod +x /app/start_server.sh

EXPOSE 3030 4040
CMD ["./start_server.sh"]