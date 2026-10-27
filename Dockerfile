# Single image: builds the React client, then runs the API server which
# serves the built client from the same origin.
FROM node:22-alpine AS client
WORKDIR /client
COPY client/package*.json ./
RUN npm ci
COPY client ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV CLIENT_DIST=/app/client-dist
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client /client/dist ./client-dist
EXPOSE 8088
USER node
CMD ["node", "src/index.js"]
