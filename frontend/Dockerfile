# Stage 1: Build React assets
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Declare build argument for API base URL (defaults to relative path for reverse proxy)
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Copy the Nginx template for dynamic environment variable substitution
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Default backend hostname and port (useful for docker-compose and Lightsail Container Service)
ENV BACKEND_URL=backend:8000

EXPOSE 5173

CMD ["nginx", "-g", "daemon off;"]
