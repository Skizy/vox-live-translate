# Install project dependencies with Bun
install:
    bun install

# Start the SolidStart development server
dev:
    bun run dev

# Build the SolidStart/Nitro production application
build:
    bun run build

# Run the generated Nitro production server
start:
    bun run start

# Type-check the application
typecheck:
    bun run typecheck

# Format source files with Biome
format:
    bun run format

# Run Biome formatter and linter checks
check:
    bun run check

# Generate Drizzle migrations from the database schema
db-generate:
    bun run db:generate

# Apply Drizzle migrations using DATABASE_URL
db-migrate:
    bun run db:migrate

# Build, upload, and restart the production app on cont
# Set DEPLOY_HOST, DEPLOY_DIR, or PORT to override the defaults.
deploy:
    ./scripts/deploy.sh
