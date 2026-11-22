ARG INQUIRY_ACCEPTANCE_BASE_IMAGE
FROM ${INQUIRY_ACCEPTANCE_BASE_IMAGE}

# Reuse verified local Linux dependencies for diagnostic execution only.
# Production release admission still requires the normal attested build.
WORKDIR /app
COPY apps/sabalan-inquiry/ ./
RUN DATABASE_URL=file:/proc/inquiry-build-must-not-open.db \
    SESSION_SECRET=build-only-inquiry-guard-check-012345678901234567890 \
    NEXT_TELEMETRY_DISABLED=1 npm run build
LABEL io.sabalan.online-qa="inquiry-runtime-guard"
