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
