FROM oven/bun:1-alpine

WORKDIR /app

COPY . .

RUN bun install --frozen-lockfile || bun install

COPY . .

CMD ["bun", "run", "index.ts"]
