package main

import (
	"Project-M/config"
	"Project-M/routes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime/debug"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	maxRequestBodyBytes   int64 = 8 << 20
	maxRequestHeaderBytes       = 1 << 20
	readHeaderTimeout           = 5 * time.Second
	readTimeout                 = 15 * time.Second
	idleTimeout                 = 60 * time.Second
	readinessTimeout            = 2 * time.Second
	shutdownTimeout             = 15 * time.Second
)

func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("X-Content-Type-Options", "nosniff")
		c.Writer.Header().Set("X-Frame-Options", "DENY")
		c.Writer.Header().Set("Referrer-Policy", "no-referrer")
		c.Writer.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// JSON API + validated image uploads only; lock CSP down as defense-in-depth (DISHY-07).
		c.Writer.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
		if c.Request.TLS != nil || strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
			c.Writer.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}

func RequestSizeLimit(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body != nil {
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		}
		c.Next()
	}
}

func CORSMiddleware() gin.HandlerFunc {
	allowedOrigins := configuredAllowedOrigins()
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		// Every response varies by Origin, including the ones asked for without
		// one: an uploaded image first fetched as a plain <img> (no Origin, no
		// Allow-Origin) was otherwise served from cache to a later crossOrigin
		// load of the same URL, which then failed CORS.
		c.Writer.Header().Set("Vary", "Origin")
		if origin != "" && (allowedOrigins[origin] || isAllowedDevOrigin(origin)) {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-Restaurant-ID, Idempotency-Key, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PATCH, PUT, DELETE")

		c.Writer.Header().Set(
			"Access-Control-Expose-Headers",
			// Content-Disposition carries the CSV export filename, and the export
			// headers say when a download was capped — a fetch() cannot read any
			// of them unless they are exposed here.
			"Content-Length, Content-Type, Idempotency-Replayed, Content-Disposition, X-Export-Total, X-Export-Rows",
		)

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}

func isAllowedDevOrigin(origin string) bool {
	if isReleaseMode() {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	if parsed.Port() != "3000" {
		return false
	}
	host := parsed.Hostname()
	if host == "localhost" || host == "127.0.0.1" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsPrivate() || ip.IsLoopback()
}

func isReleaseMode() bool {
	return gin.Mode() == gin.ReleaseMode || os.Getenv("GIN_MODE") == gin.ReleaseMode
}

func trustedCloudflareClientIP() gin.HandlerFunc {
	return func(c *gin.Context) {
		remoteHost, remotePort, err := net.SplitHostPort(c.Request.RemoteAddr)
		if err != nil {
			remoteHost = strings.Trim(c.Request.RemoteAddr, "[]")
			remotePort = "0"
		}
		peerIP := net.ParseIP(remoteHost)
		if peerIP != nil && peerIP.IsLoopback() {
			forwardedIP := net.ParseIP(strings.TrimSpace(c.GetHeader("CF-Connecting-IP")))
			if forwardedIP != nil && !forwardedIP.IsUnspecified() {
				c.Request.RemoteAddr = net.JoinHostPort(forwardedIP.String(), remotePort)
			}
		}
		c.Next()
	}
}

func sanitizedAccessLogger(logger *log.Logger) gin.HandlerFunc {
	if logger == nil {
		logger = log.Default()
	}
	return func(c *gin.Context) {
		startedAt := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		logger.Printf(
			"http_request method=%s route=%s status=%d latency_ms=%d",
			c.Request.Method,
			route,
			c.Writer.Status(),
			time.Since(startedAt).Milliseconds(),
		)
	}
}

func sanitizedRecovery(logger *log.Logger) gin.HandlerFunc {
	if logger == nil {
		logger = log.Default()
	}
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, recovered any) {
		route := c.FullPath()
		if route == "" {
			route = "<unmatched>"
		}
		logger.Printf("panic route=%s recovered_type=%T\n%s", route, recovered, debug.Stack())
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "internal server error"})
	})
}

func registerHealthRoutes(r *gin.Engine, readyCheck func(context.Context) error) {
	liveness := func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
	readiness := func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), readinessTimeout)
		defer cancel()
		if readyCheck == nil || readyCheck(ctx) != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "unavailable"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	}
	// /health is kept as a readiness alias for existing monitors.
	r.GET("/health", readiness)
	r.GET("/livez", liveness)
	r.GET("/readyz", readiness)
}

func newRouter(readyCheck func(context.Context) error) *gin.Engine {
	r := gin.New()
	r.MaxMultipartMemory = maxRequestBodyBytes
	_ = r.SetTrustedProxies(nil)
	r.Use(trustedCloudflareClientIP())
	r.Use(sanitizedAccessLogger(log.Default()))
	r.Use(sanitizedRecovery(log.Default()))
	r.Use(SecurityHeaders())
	r.Use(RequestSizeLimit(maxRequestBodyBytes))
	r.Use(CORSMiddleware())
	r.Static("/uploads", "./uploads")
	registerHealthRoutes(r, readyCheck)
	r.NoRoute(func(c *gin.Context) {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	})
	routes.SetupRoutes(r)
	return r
}

func serverAddress() string {
	host := os.Getenv("SERVER_HOST")
	if host == "" {
		host = "localhost"
	}
	port := os.Getenv("SERVER_PORT")
	if port == "" {
		port = "8080"
	}
	return net.JoinHostPort(host, port)
}

func newHTTPServer(address string, handler http.Handler) *http.Server {
	return &http.Server{
		Addr:              address,
		Handler:           handler,
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		// SSE responses intentionally have no global write deadline.
		WriteTimeout:   0,
		IdleTimeout:    idleTimeout,
		MaxHeaderBytes: maxRequestHeaderBytes,
	}
}

func run() (resultErr error) {
	// Honor GIN_MODE from the environment. Production (docker-compose) sets
	// GIN_MODE=release, which keeps CORS locked to the configured origins. When
	// it is unset (local dev) gin stays in debug mode so isAllowedDevOrigin lets
	// http://localhost:3000 through and browser auth calls are not CORS-blocked.
	if mode := strings.TrimSpace(os.Getenv("GIN_MODE")); mode != "" {
		gin.SetMode(mode)
	} else {
		gin.SetMode(gin.DebugMode)
	}
	if err := config.LoadRuntimeEnvironment(); err != nil {
		return err
	}
	if err := config.ValidateRuntimeEnvironment(); err != nil {
		return err
	}
	if err := config.ConnectionDB(); err != nil {
		return err
	}
	defer func() {
		if err := config.CloseDatabase(); resultErr == nil && err != nil {
			resultErr = err
		}
	}()
	if err := config.EnsureSchemaCurrent(config.DB()); err != nil {
		return err
	}

	var acceptingTraffic atomic.Bool
	acceptingTraffic.Store(true)
	readyCheck := func(ctx context.Context) error {
		if !acceptingTraffic.Load() {
			return errors.New("server is draining")
		}
		return config.CheckDatabaseReadiness(ctx)
	}
	server := newHTTPServer(serverAddress(), newRouter(readyCheck))

	signalContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	serverErrors := make(chan error, 1)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	log.Printf("backend listening address=%s schema_version=%d", server.Addr, config.CurrentSchemaVersion)
	select {
	case err := <-serverErrors:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve backend: %w", err)
		}
		return nil
	case <-signalContext.Done():
	}

	acceptingTraffic.Store(false)
	server.SetKeepAlivesEnabled(false)
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancelShutdown()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Printf("graceful shutdown deadline exceeded; closing active connections")
		if closeErr := server.Close(); closeErr != nil && !errors.Is(closeErr, http.ErrServerClosed) {
			return fmt.Errorf("close backend server: %w", closeErr)
		}
	}
	if err := <-serverErrors; err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("serve backend during shutdown: %w", err)
	}
	return nil
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func configuredAllowedOrigins() map[string]bool {
	origins := map[string]bool{}
	if !isReleaseMode() {
		origins["http://localhost:3000"] = true
		origins["http://127.0.0.1:3000"] = true
	}

	if frontendURL := strings.TrimRight(strings.TrimSpace(os.Getenv("FRONTEND_URL")), "/"); frontendURL != "" {
		origins[frontendURL] = true
	}

	for _, raw := range strings.Split(os.Getenv("CORS_ALLOWED_ORIGINS"), ",") {
		origin := strings.TrimRight(strings.TrimSpace(raw), "/")
		if origin != "" {
			origins[origin] = true
		}
	}

	return origins
}
