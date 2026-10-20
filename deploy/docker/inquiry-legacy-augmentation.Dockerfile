ARG INQUIRY_LEGACY_COMPILED_IMAGE
FROM ${INQUIRY_LEGACY_COMPILED_IMAGE}
WORKDIR /app
# Runtime ownership is added around the exact installed legacy application.
# Never overlay .next/public/config/Prisma/node_modules or rebuild its actions.
RUN apt-get -o Acquire::ForceIPv4=true update \
 && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends python3 util-linux \
 && rm -rf /var/lib/apt/lists/*
COPY online-runtime/ /app/online-runtime/
RUN node /app/online-runtime/inquiry-legacy-compiled-identity.cjs /app/online-runtime/legacy-compiled-source.json
LABEL io.sabalan.inquiry.legacy-business-source="COMPILED_IMAGE" \
      io.sabalan.inquiry.legacy-business-image="sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e"
# The original guardian, scope and SQLite ownership are supplied by the fixed
# original controller. An idle carrier itself grants no serving authority.
ENTRYPOINT ["/usr/local/bin/node","-e","setInterval(()=>{},2147483647)"]
CMD []
