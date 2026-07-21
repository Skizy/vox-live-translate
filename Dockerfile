FROM oven/bun:1

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0

COPY .output .output

EXPOSE 5080

CMD ["bun", ".output/server/index.mjs"]
