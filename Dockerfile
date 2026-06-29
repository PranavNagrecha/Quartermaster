# Quartermaster MCP gateway — Node 22 slim image for HTTP-downstream federation.
# Primary deployment is still stdio via npx; use this when mounting config in a container.
FROM node:22-bookworm-slim

RUN useradd --create-home --uid 10001 quartermaster
WORKDIR /app

RUN npm install -g quartermaster-mcp@0.1.4 \
  && npm cache clean --force

USER quartermaster
ENV NODE_ENV=production

ENTRYPOINT ["quartermaster-mcp"]
CMD ["--config", "/config/quartermaster.json"]
