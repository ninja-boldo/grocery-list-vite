FROM python:3.11-slim-bookworm

WORKDIR /app

# python deps
COPY requirements.txt .
RUN pip install -U pip uv && \
    uv pip install --system -r requirements.txt --no-cache-dir

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git libgomp1

RUN git clone --depth 1 https://github.com/ggerganov/llama.cpp /tmp/llama.cpp

RUN cmake -B /tmp/llama.cpp/build -S /tmp/llama.cpp \
    -DGGML_METAL=OFF \
    -DGGML_BLAS=OFF \
    -DBUILD_SHARED_LIBS=OFF

RUN cmake --build /tmp/llama.cpp/build --target llama-server -j$(nproc)

RUN cp /tmp/llama.cpp/build/bin/llama-server /usr/local/bin/llama-server && \
    rm -rf /tmp/llama.cpp

RUN apt-get purge -y build-essential cmake git && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# copy backend and frontend dist
COPY server /app/server

# copy start script
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3030 4040
CMD ["python", "server/server.py"]