set dotenv-load

port := env("PORT", "5080")

# Install project dependencies with Bun
install:
    bun install

# Start the Vite development server
start:
    bun run dev

# Create the production frontend bundle
build:
    bun run build

# Serve the production bundle and authenticated API
serve:
    PORT={{ port }} bun run serve

# Format code with Biome
format:
    bun run format

# Lint code with Biome
lint:
    bun run lint

# Run Biome formatter and linter checks
check:
    bun run check

# Type-check the Vite application
typecheck:
    bun run typecheck

# Regenerate PWA PNG icons from the theme palette
generate-icons:
    python3 scripts/generate-icons.py
