ARG INQUIRY_LEGACY_COMPILED_IMAGE
FROM ${INQUIRY_LEGACY_COMPILED_IMAGE}
WORKDIR /app
# Runtime ownership is added around the exact installed legacy application.
# Never overlay .next/public/config/Prisma/node_modules or rebuild its actions.
COPY online-runtime/ /app/online-runtime/
COPY online-runtime/python3 /usr/bin/python3
RUN node -e "const f=require('node:fs');for(const p of ['/usr/bin/python3','/app/online-runtime/python/usr/bin/python3.11','/app/online-runtime/python/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'])f.chmodSync(p,0o555)" \
 && /usr/bin/python3 -I -B -c "import ssl,sqlite3,fcntl,ctypes,hashlib; assert ssl.OPENSSL_VERSION; assert sqlite3.sqlite_version; assert ctypes.CDLL(None)"
RUN node /app/online-runtime/inquiry-legacy-compiled-identity.cjs /app/online-runtime/legacy-compiled-source.json
LABEL io.sabalan.inquiry.legacy-business-source="COMPILED_IMAGE" \
      io.sabalan.inquiry.legacy-business-image="sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e"
# The original guardian, scope and SQLite ownership are supplied by the fixed
# original controller. An idle carrier itself grants no serving authority.
ENTRYPOINT ["/usr/local/bin/node","-e","setInterval(()=>{},2147483647)"]
CMD []
