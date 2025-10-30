# gotta be invoked for build from one layer above to be able to access the whole grocery list 2 folder
FROM python:3.11-slim-bookworm AS base

# system setup
ENV DEBIAN_FRONTEND=noninteractive

# install dependencies (no duplicate python installs)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        curl git build-essential sudo file locales postgresql-client && \
    rm -rf /var/lib/apt/lists/*

# locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8 \
    LANGUAGE=en_US:en \
    LC_ALL=en_US.UTF-8

# node.js setup
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/* && \
    node --version && npm --version

WORKDIR /app

# copy and install npm deps
COPY grocery-list2/package*.json ./
RUN npm install

# copy frontend source
COPY grocery-list2/ .

ENV GROQ_API_KEY=""
ENV OPENAI_API_KEY=""

# install yarn (needed for CMD)
RUN npm install --global yarn

RUN yarn install

# clear npm cache safely (remove dead data only)
RUN yarn cache clean

# rebuild to fix rollup issue (same behavior)
RUN yarn run build || (echo "yarn build failed" && exit 1)

# install uv and python deps
RUN pip install --no-cache-dir -U pip uv && \
    uv pip install --system -r requirements.txt --no-cache-dir || \
    (echo "Auto-fixing incompatible versions..." && \
     sed -e 's/contourpy==1\.3\.3/contourpy==1.3.2/g' \
         -e 's/networkx==3\.5/networkx>=3.4,<3.5/g' \
         -e '/pyobjc-core/d' \
         -e '/pyobjc-framework/d' \
         -e '/PyGetWindow/d' \
         -e '/PyAutoGUI/d' \
         -e '/MouseInfo/d' \
         -e '/PyMsgBox/d' \
         requirements.txt > requirements_fixed.txt && \
     echo "Fixed requirements.txt -> requirements_fixed.txt" && \
     uv pip install --system -r requirements_fixed.txt --no-cache-dir)

# expose ports (same ones)
EXPOSE 3030 4040 5000

# same combined startup
CMD ["bash", "-c", "python server/server.py & \
                    sleep 2 && yarn run preview --port 4040 --host 0.0.0.0 & \
                    wait"]
