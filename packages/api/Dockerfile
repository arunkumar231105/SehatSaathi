FROM node:22-alpine

WORKDIR /app

# Deps first so an edit to src/ does not reinstall node_modules on every
# rebuild — during a 24h build we rebuild this image a lot.
COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3000

# tsx runs TypeScript directly. No build step is deliberate: it removes a
# whole class of "works locally, broken in the image" failures.
CMD ["npx", "tsx", "src/server.ts"]
