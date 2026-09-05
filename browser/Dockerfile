FROM node:20-alpine

# Playwright needs a few system libs for Chromium on Alpine.
RUN apk add --no-cache \
    nss \
    libnspr4 \
    libatk-bridge2.0.so.0 \
    libatk-1.0.so.0 \
    libcups.so.2 \
    libdrm.so.2 \
    libxkbcommon.so.0 \
    libxcomposite.so.1 \
    libxdamage.so.1 \
    libxrandr.so.2 \
    libgbm.so.1 \
    libexposed \
    libexpat.so.1 \
    libfontconfig.so.1 \
    libfreetype.so.6 \
    libxcb.so.1 \
    libxshmfence.so.1 \
    mesa-gl \
    mesa-dri-gallium \
    ttf-freefont \
    wqy-cyrillic-fonts \
    ttf-dejavu \
    udev

WORKDIR /app

COPY browser/package*.json ./browser/
RUN cd browser && npm ci --only=production

# Install Playwright browsers (Chromium) into the browser service dir.
RUN cd browser && npx playwright install chromium

COPY browser/ ./browser/

EXPOSE 3001
CMD ["node", "browser/index.js"]
