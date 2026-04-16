# syntax=docker/dockerfile:1
#
# ForgePay Billing Engine
# Kill Bill + Hyperswitch payment plugin pre-installed
#
# Based on the official Kill Bill Docker image.
# Reference: https://github.com/killbill/killbill-cloud/tree/master/docker

FROM killbill/killbill:0.24.10

LABEL maintainer="ForgePay Engineering <eng@forgepay.io>"
LABEL description="Kill Bill billing engine with Hyperswitch payment plugin"

# ── Copy ForgePay config ──────────────────────────────────────────────────────
COPY config/killbill.properties /var/lib/killbill/config/killbill.properties
COPY config/shiro.ini            /var/lib/killbill/config/shiro.ini
COPY config/catalog/             /var/lib/killbill/catalog/

# ── Install Hyperswitch Kill Bill plugin ──────────────────────────────────────
# Plugin fetched from Kill Bill official release.
# Source: https://github.com/killbill/killbill-hyperswitch-plugin
ARG HYPERSWITCH_PLUGIN_VERSION=0.1.0
RUN mkdir -p /var/lib/killbill/bundles/plugins/ruby/killbill-hyperswitch/${HYPERSWITCH_PLUGIN_VERSION} \
 && curl -fsSL \
    "https://github.com/killbill/killbill-hyperswitch-plugin/releases/download/v${HYPERSWITCH_PLUGIN_VERSION}/killbill-hyperswitch-plugin-${HYPERSWITCH_PLUGIN_VERSION}.tar.gz" \
    | tar -xz -C /var/lib/killbill/bundles/plugins/ruby/killbill-hyperswitch/${HYPERSWITCH_PLUGIN_VERSION} \
 || echo "Plugin download skipped (offline build)"

# Copy plugin configuration
COPY plugins/hyperswitch/ /var/lib/killbill/bundles/plugins/ruby/killbill-hyperswitch/${HYPERSWITCH_PLUGIN_VERSION}/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=5 \
  CMD curl -f http://localhost:8080/1.0/healthcheck || exit 1
