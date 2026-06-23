# syntax=docker/dockerfile:1
#
# ForgePay Billing Engine — multi-stage build
# Stage 1: build the ForgePay Kill Bill payment plugin JAR
# Stage 2: Kill Bill runtime with the plugin pre-installed
#

# ── Stage 1: Maven build ───────────────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-11 AS builder

COPY forgepay-plugin/ /build/
WORKDIR /build
RUN mvn package -DskipTests --no-transfer-progress

# ── Stage 2: Kill Bill runtime ─────────────────────────────────────────────────
FROM killbill/killbill:0.24.10

LABEL maintainer="ForgePay Engineering <eng@forgepay.io>"
LABEL description="Kill Bill billing engine with ForgePay payment plugin"

ENV KILLBILL_PLUGINS_DIR=/var/lib/killbill/bundles

# Create plugin directories
RUN mkdir -p ${KILLBILL_PLUGINS_DIR}/platform \
             ${KILLBILL_PLUGINS_DIR}/forgepay-plugin

# Copy built plugin JAR from builder stage
COPY --from=builder /build/target/forgepay-payment-plugin-*-jar-with-dependencies.jar \
     ${KILLBILL_PLUGINS_DIR}/forgepay-plugin/forgepay-payment-plugin.jar

# Copy ForgePay config
COPY config/killbill.properties /etc/killbill/killbill.properties
COPY config/shiro.ini            /etc/killbill/shiro.ini
COPY config/catalog/             /etc/killbill/catalog/

# Copy and set up the entrypoint
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --retries=5 \
  CMD curl -f http://localhost:8080/1.0/healthcheck || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
