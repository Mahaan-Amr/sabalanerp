ARG INQUIRY_NATIVE_ACCEPTANCE_BASE_IMAGE
FROM ${INQUIRY_NATIVE_ACCEPTANCE_BASE_IMAGE}

# Private diagnostic image using the measured installed Inquiry dependency
# image and a separately evidenced Linux source build. Not a production build.
WORKDIR /app
RUN apt-get -o Acquire::ForceIPv4=true update \
  && apt-get -o Acquire::ForceIPv4=true install -y --no-install-recommends python3 util-linux \
  && rm -rf /var/lib/apt/lists/*
ADD inquiry-build.tar.gz /app/
COPY online-runtime /app/online-runtime/
COPY native-http-observer.cjs /app/online-runtime/native-http-observer.cjs
LABEL io.sabalan.online-qa="inquiry-native-actions"
