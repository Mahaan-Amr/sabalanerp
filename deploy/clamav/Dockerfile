# Official 1.4.6 amd64 image; the derived image is separately pinned for production.
ARG CLAMAV_BASE_IMAGE=clamav/clamav@sha256:fefe26428207c7ec3e51396376cbd5084528f134b504db76a92363ed534e0b10
FROM ${CLAMAV_BASE_IMAGE}
ARG CLAMAV_ACQUISITION_TRANSPORT=direct
ENV CLAMAV_ACQUISITION_TRANSPORT=${CLAMAV_ACQUISITION_TRANSPORT}
COPY deploy/clamav/clamd.conf deploy/clamav/freshclam.conf /etc/clamav/
COPY deploy/clamav/freshclam.conf /usr/local/share/sabalan-clamav-freshclam.conf
COPY deploy/clamav/acquisition-transport.sh /usr/local/bin/sabalan-clamav-acquisition-transport
COPY deploy/clamav/health.sh /usr/local/bin/sabalan-clamav-health
COPY deploy/clamav/update-once.sh /usr/local/bin/sabalan-clamav-update-once
COPY deploy/clamav/updater.sh /usr/local/bin/sabalan-clamav-updater
COPY deploy/clamav/entrypoint.sh /usr/local/bin/sabalan-clamav-entrypoint
RUN case "$CLAMAV_ACQUISITION_TRANSPORT" in \
      direct) ;; \
      backup-host-http-v1) printf '%s\n' 'HTTPProxyServer sabalan-clamav-egress' 'HTTPProxyPort 10808' >> /etc/clamav/freshclam.conf ;; \
      *) exit 1 ;; \
    esac && printf '%s\n' "$CLAMAV_ACQUISITION_TRANSPORT" > /usr/local/share/sabalan-clamav-transport \
    && chmod 755 /usr/local/bin/sabalan-clamav-* && command -v flock
ENTRYPOINT ["/sbin/tini", "-g", "--", "/usr/local/bin/sabalan-clamav-entrypoint"]
HEALTHCHECK --interval=15s --timeout=10s --start-period=5m --retries=3 CMD /usr/local/bin/sabalan-clamav-health
