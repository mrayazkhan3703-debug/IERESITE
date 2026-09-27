FROM oven/bun:1.3.4-debian@sha256:9d9504d425a8b85c5cf162c1c354f9403e15583e0f3e1de3750ce3723d3e89ac AS bun-runtime

FROM mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e

WORKDIR /app
COPY --from=bun-runtime /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run db:generate

ENV CI=true
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
CMD ["bun", "run", "test:a11y"]
