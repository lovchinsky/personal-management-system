FROM oven/bun:1.3.10-slim

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        git \
        tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/gbrain

ARG GBRAIN_REF
RUN test -n "${GBRAIN_REF}"

RUN git clone https://github.com/garrytan/gbrain.git . \
    && git checkout "${GBRAIN_REF}" \
    && bun install --frozen-lockfile

RUN printf '%s\n' \
    '#!/bin/sh' \
    'exec bun /opt/gbrain/src/cli.ts "$@"' \
    > /usr/local/bin/gbrain \
    && chmod +x /usr/local/bin/gbrain

RUN mkdir -p /data/home/.gbrain /brain \
    && chown -R bun:bun /data/home /brain /opt/gbrain

USER bun

ENV HOME=/data/home
ENV GBRAIN_HOME=/data/home/.gbrain

WORKDIR /brain
EXPOSE 3131

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["gbrain", "--help"]
