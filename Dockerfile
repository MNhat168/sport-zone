### Build stage ###
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

### Production stage ###
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled sources and runtime assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/templates ./src/templates

# Expose default NestJS port (can be overridden via PORT env)
EXPOSE 3000

CMD ["node", "dist/main"]

