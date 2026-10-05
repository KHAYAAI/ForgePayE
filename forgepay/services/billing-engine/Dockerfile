# syntax=docker/dockerfile:1
#
# FORGE billing engine: stock Kill Bill 0.24.10 plus the forgepay-hyperswitch
# payment plugin and FORGE's catalog. Uses the image's own entrypoint
# (killbill.sh → Tomcat); configuration is via KB_* environment variables, see
# config/killbill.properties.

# ── Stage 1: build the payment plugin bundle ──────────────────────────────────
FROM maven:3.9-eclipse-temurin-11 AS builder
WORKDIR /build
COPY forgepay-plugin/pom.xml ./
RUN mvn -B -q dependency:go-offline
COPY forgepay-plugin/src ./src
RUN mvn -B -q package

# ── Stage 2: Kill Bill ────────────────────────────────────────────────────────
FROM killbill/killbill:0.24.10

LABEL description="FORGE billing engine: Kill Bill with the forgepay-hyperswitch payment plugin"

# Kill Bill loads Java plugins from bundles/plugins/java/<name>/<version>/.
COPY --from=builder --chown=tomcat:tomcat /build/target/forgepay-hyperswitch-plugin-0.2.0.jar \
     /var/lib/killbill/bundles/plugins/java/forgepay-hyperswitch/0.2.0/forgepay-hyperswitch-plugin-0.2.0.jar

COPY --chown=tomcat:tomcat config/killbill.properties /var/lib/killbill/killbill.properties
COPY --chown=tomcat:tomcat config/catalog/            /var/lib/killbill/config/catalog/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -f http://localhost:8080/1.0/healthcheck || exit 1
