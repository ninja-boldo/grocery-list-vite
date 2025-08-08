# gotta be invoked for build from one layer above to be able to access the whole grocery list 2 folder
FROM python:3.11-slim-bullseye AS base



# updating and installing python
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    curl git build-essential python3 python3-pip python3-venv sudo file locales ruby-full



# Set locale
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8



# do the duckdb install
RUN curl https://install.duckdb.org | sh



# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    node --version && npm --version



RUN node --version && npm --version && which npm



# Set working directory (CRUCIAL CHANGE)
WORKDIR /app



# Copy package files first (for better caching)
COPY grocery-list2/package*.json ./



# Install npm dependencies
RUN npm install



# Copy the project files
COPY grocery-list2/ .



#install yarn
RUN npm install --global yarn



# Clear cache and reinstall to fix rollup issue
RUN rm -rf node_modules package-lock.json && \
    npm cache clean --force && \
    npm install || (echo "npm install failed" && exit 1) && \
    npm run build || (echo "npm build failed" && exit 1)



RUN pip install uv



# Install Python dependencies with automatic version fixing
RUN pip install --upgrade pip && \
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



# Expose ports
EXPOSE 3030 4040 5000


CMD ["bash", "-c", "python server/server.py & yarn run preview -- --port 4040 --host 0.0.0.0"]