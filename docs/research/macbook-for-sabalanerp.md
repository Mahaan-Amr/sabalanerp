# MacBook sizing for SabalanERP-like development

Research date: 2026-08-09

## Workload observed in this repository

SabalanERP is a multi-application TypeScript system rather than a single lightweight web app. The repository contains Next.js 14 and 16 frontends, React 18 and 19, an Express backend, Prisma 5 and 6, PostgreSQL, Redis, Playwright, Puppeteer/Chromium, Three.js, Konva, Recharts, Excel processing, FFmpeg, and ClamAV. Its normal local Docker Compose project runs five services whose declared memory limits total approximately 7.25 GB. The main frontend scripts also permit an 8 GB V8 heap for development and production builds.

This makes memory capacity, sustained CPU performance, cooling, and SSD capacity more important than peak GPU performance.

## Current Apple hardware facts

- The current MacBook Pro is available with M5, M5 Pro, and M5 Max. The 14-inch M5 Pro can be configured with 48 GB or 64 GB unified memory and 1-4 TB storage. M5 Pro models include three Thunderbolt 5 ports, HDMI, and support up to three external displays. [Apple MacBook Pro technical specifications](https://www.apple.com/macbook-pro/specs/)
- Apple announced the M5 Pro 14-inch model at a US launch price of $2,199 and the 16-inch at $2,699. Live regional and configured prices can differ and should be checked at purchase time. [Apple Newsroom, March 3, 2026](https://www.apple.com/newsroom/2026/03/apple-introduces-macbook-pro-with-all-new-m5-pro-and-m5-max/)
- The current M5 MacBook Air supports at most 32 GB unified memory. A 13-inch configuration with 32 GB memory and 1 TB storage is listed at $1,699 in the US store. [Apple MacBook Air technical specifications](https://www.apple.com/macbook-air/specs/) and [Apple 32 GB/1 TB store configuration](https://www.apple.com/shop/buy-mac/macbook-air/13-inch-starlight-m5-chip-10-core-cpu-10-core-gpu-32gb-memory-1tb-storage)
- Docker Desktop supports Apple silicon. Docker recommends Rosetta 2 for the best experience with the remaining AMD64-only tooling, though Rosetta is no longer strictly required. [Docker Desktop for Mac installation documentation](https://docs.docker.com/desktop/setup/install/mac-install/)
- The repository's official `postgres:15-alpine` image is published for `arm64v8`, as are Redis 7 Alpine images, so its core data services can run natively on Apple silicon. [Postgres official image architectures](https://hub.docker.com/_/postgres) and [Redis 7 ARM64 tags](https://hub.docker.com/r/arm64v8/redis/tags)

## Recommendation

The balanced long-term configuration is a **14-inch MacBook Pro, M5 Pro, 48 GB unified memory, 1 TB SSD**. Choose the 16-inch version only when the larger built-in workspace and battery matter more than portability and price. Choose 2 TB storage if several Docker projects, large databases, media, or local AI models will remain on the machine.

The minimum sensible new configuration is **32 GB unified memory and 1 TB storage**. A 32 GB MacBook Air can run this stack, but its memory ceiling and fanless design offer less headroom for sustained Docker builds, integration tests, browsers, and AI coding tools. An M5 Max is poor value for this workload unless the machine will also run large local language models, heavy 3D/rendering, or other GPU-intensive work.
