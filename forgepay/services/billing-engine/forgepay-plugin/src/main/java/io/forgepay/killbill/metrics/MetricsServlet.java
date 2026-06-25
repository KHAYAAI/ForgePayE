package io.forgepay.killbill.metrics;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * HTTP servlet that exposes Prometheus metrics at /metrics endpoint.
 * Returns metrics in Prometheus text format (text/plain).
 *
 * Usage:
 *   - GET /metrics - returns all Prometheus metrics
 *   - Can be registered with Kill Bill's plugin servlet container
 */
public class MetricsServlet extends HttpServlet {
    private static final Logger logger = LoggerFactory.getLogger(MetricsServlet.class);
    private static final long serialVersionUID = 1L;

    /**
     * Handles GET requests to /metrics endpoint.
     * Returns Prometheus metrics in text/plain format.
     */
    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        try {
            // Set response headers
            response.setContentType("text/plain; version=0.0.4; charset=utf-8");
            response.setCharacterEncoding("UTF-8");
            response.setStatus(HttpServletResponse.SC_OK);

            // Get Prometheus metrics as text
            String metricsText = MetricsRegistry.getPrometheusMetricsText();

            // Write metrics to response body
            response.getWriter().write(metricsText);
            response.getWriter().flush();

            logger.debug("Prometheus metrics scraped successfully");
        } catch (IllegalStateException e) {
            logger.error("MetricsRegistry not initialized", e);
            response.setStatus(HttpServletResponse.SC_SERVICE_UNAVAILABLE);
            response.getWriter().write("Metrics service unavailable: " + e.getMessage());
            response.getWriter().flush();
        } catch (Exception e) {
            logger.error("Error generating Prometheus metrics", e);
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
            response.getWriter().write("Error generating metrics: " + e.getMessage());
            response.getWriter().flush();
        }
    }

    /**
     * Handles HEAD requests to /metrics endpoint.
     * Returns same headers as GET but without body.
     */
    @Override
    protected void doHead(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        try {
            response.setContentType("text/plain; version=0.0.4; charset=utf-8");
            response.setCharacterEncoding("UTF-8");
            response.setStatus(HttpServletResponse.SC_OK);
            logger.debug("Prometheus metrics HEAD request handled");
        } catch (Exception e) {
            logger.error("Error handling HEAD request for metrics", e);
            response.setStatus(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Rejects all other HTTP methods.
     */
    @Override
    protected void service(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {
        String method = request.getMethod();
        if ("GET".equalsIgnoreCase(method) || "HEAD".equalsIgnoreCase(method)) {
            super.service(request, response);
        } else {
            response.setStatus(HttpServletResponse.SC_METHOD_NOT_ALLOWED);
            response.addHeader("Allow", "GET, HEAD");
            response.getWriter().write("Method " + method + " not allowed for /metrics endpoint");
            response.getWriter().flush();
            logger.warn("Unsupported HTTP method {} for /metrics endpoint", method);
        }
    }

    /**
     * Called when servlet is initialized.
     * Ensures MetricsRegistry is initialized.
     */
    @Override
    public void init() throws ServletException {
        try {
            if (MetricsRegistry.getPrometheusRegistry() == null) {
                MetricsRegistry.initialize();
            }
            logger.info("MetricsServlet initialized and ready to serve /metrics");
        } catch (IllegalStateException e) {
            // MetricsRegistry not yet initialized, that's OK - will be initialized later
            logger.debug("MetricsRegistry not yet initialized during servlet init");
        } catch (Exception e) {
            logger.error("Failed to initialize MetricsServlet", e);
            throw new ServletException("Failed to initialize MetricsServlet", e);
        }
    }
}
