FROM oven/bun:1 AS migrator

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY drizzle drizzle
COPY drizzle.config.ts ./
COPY src/server/db/schema.ts src/server/db/schema.ts

FROM oven/bun:1

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0

COPY .output .output

EXPOSE 5080

CMD ["bun", ".output/server/index.mjs"]
