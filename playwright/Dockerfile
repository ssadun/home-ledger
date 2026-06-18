FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /mcp

RUN npm init -y && npm install @playwright/mcp@latest \
  && npx playwright install chromium \
  && npx playwright install-deps chromium

EXPOSE 3237

CMD ["npx", "@playwright/mcp", "--browser", "chromium", "--headless", "--no-sandbox", \
  "--allowed-hosts", "*", "--port", "3237", "--host", "0.0.0.0"]
