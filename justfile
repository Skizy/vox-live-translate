set dotenv-load

port := env("PORT", "5080")

# Install project dependencies with Bun
install:
    bun install

# Serve the PWA locally
start:
    PORT={{ port }} bun src/server.ts

# Build the browser client bundle
build-client:
    bun run build:client

# Format code with Biome
format:
    bun run format

# Lint code with Biome
lint:
    bun run lint

# Run Biome formatter and linter checks
check:
    bun run check
