# Tahap Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Tahap Production
FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist

# Cloud Run secara default menggunakan port 8080
EXPOSE 8080

# Jalankan static file server
CMD ["serve", "-s", "dist", "-l", "8080"]
