FROM node:22-alpine AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json* ./
RUN npm install
COPY server/ ./
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget \
  && addgroup -S hsc && adduser -S hsc -G hsc
COPY --from=build /app/server/package.json /app/server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY public ./public
ENV PUBLIC_DIR=/app/public
ENV PORT=8080
USER hsc
EXPOSE 8080
WORKDIR /app/server
CMD ["node", "dist/index.js"]
