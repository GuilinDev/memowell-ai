FROM node:22-slim

WORKDIR /app

# Copy workspace root files
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy workspace packages
COPY packages/ packages/
COPY apps/next/ apps/next/

# Install all deps
RUN npm ci

# Build Next.js
RUN cd apps/next && npm run build

EXPOSE 3000
ENV PORT=3000

WORKDIR /app/apps/next
CMD ["npx", "next", "start", "-p", "3000"]
