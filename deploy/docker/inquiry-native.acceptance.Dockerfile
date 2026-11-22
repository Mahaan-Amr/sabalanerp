ARG INQUIRY_NATIVE_ACCEPTANCE_BASE_IMAGE
FROM ${INQUIRY_NATIVE_ACCEPTANCE_BASE_IMAGE}

# Private diagnostic image using the measured installed Inquiry dependency
# image and a separately evidenced Linux source build. Not a production build.
WORKDIR /app
RUN apt-get -o Acquire::ForceIPv4=true update \
  && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends python3 util-linux \
  && rm -rf /var/lib/apt/lists/*
COPY inquiry-dependency-identity.cjs inquiry-dependency-identity.json /tmp/
RUN node -e "const a=require('node:assert/strict'),f=require('node:fs'),v=require('/tmp/inquiry-dependency-identity.cjs');a.deepEqual(v.inquiryDependencyIdentity('/app/node_modules'),JSON.parse(f.readFileSync('/tmp/inquiry-dependency-identity.json','utf8')));" \
  && rm /tmp/inquiry-dependency-identity.cjs /tmp/inquiry-dependency-identity.json
ADD inquiry-build.tar.gz /app/
COPY online-runtime /app/online-runtime/
COPY native-http-observer.cjs /app/online-runtime/native-http-observer.cjs
LABEL io.sabalan.online-qa="inquiry-native-actions"

COPY --chmod=0644 inquiry-compiled-browser.cjs /app/inquiry-compiled-browser.cjs
COPY --chmod=0755 run-inquiry-with-recovery.sh /app/run-inquiry-with-recovery.sh
CMD ["/app/run-inquiry-with-recovery.sh"]
