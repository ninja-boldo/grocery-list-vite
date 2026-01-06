#!/bin/bash

docker build --platform linux/amd64 -t boldo42/grocery-list-vite -f Dockerfile . 

docker push boldo42/grocery-list-vite:latest