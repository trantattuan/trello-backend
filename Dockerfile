FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm install
COPY prisma ./prisma
RUN npx prisma generate
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache openssl
RUN addgroup -S app && adduser -S -G app app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
RUN chown -R app:app /app
RUN apk add --no-cache postgresql16-client rclone tar gzip curl && \
    curl -sSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc && \
    chmod +x /usr/local/bin/mc && \
    mkdir -p /home/app/.config/rclone /tmp/backups && \
    chown -R app:app /home/app/.config /tmp/backups
USER app

EXPOSE 3001
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/app.js"]
