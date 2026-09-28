package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestSanitizedAccessLoggerUsesRouteTemplate(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var output bytes.Buffer
	router := gin.New()
	router.Use(sanitizedAccessLogger(log.New(&output, "", 0)))
	router.GET("/api/public/table-orders/:token", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(
		http.MethodGet,
		"/api/public/table-orders/private-table-token?api_key=private-query-value",
		nil,
	)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	logged := output.String()
	if !strings.Contains(logged, "route=/api/public/table-orders/:token") {
		t.Fatalf("access log did not use route template: %q", logged)
	}
	for _, secret := range []string{"private-table-token", "private-query-value", "api_key"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("access log exposed %q: %q", secret, logged)
		}
	}
}

func TestSanitizedRecoveryDoesNotExposePathTokenOrPanicValue(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var output bytes.Buffer
	logger := log.New(&output, "", 0)
	router := gin.New()
	router.Use(sanitizedAccessLogger(logger))
	router.Use(sanitizedRecovery(logger))
	router.GET("/api/invitations/:token", func(*gin.Context) {
		panic("private-provider-response")
	})

	request := httptest.NewRequest(http.MethodGet, "/api/invitations/private-invitation-token", nil)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	logged := output.String()
	if !strings.Contains(logged, "route=/api/invitations/:token") {
		t.Fatalf("recovery log did not use route template: %q", logged)
	}
	for _, secret := range []string{"private-invitation-token", "private-provider-response"} {
		if strings.Contains(logged, secret) {
			t.Fatalf("recovery log exposed %q: %q", secret, logged)
		}
	}
}

func TestTrustedCloudflareClientIPAcceptsHeaderOnlyFromLoopback(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(trustedCloudflareClientIP())
	router.GET("/client-ip", func(c *gin.Context) {
		c.String(http.StatusOK, c.ClientIP())
	})

	tests := []struct {
		name       string
		remoteAddr string
		headerIP   string
		want       string
	}{
		{
			name:       "loopback proxy",
			remoteAddr: "127.0.0.1:43120",
			headerIP:   "203.0.113.42",
			want:       "203.0.113.42",
		},
		{
			name:       "untrusted direct peer",
			remoteAddr: "198.51.100.20:43120",
			headerIP:   "203.0.113.42",
			want:       "198.51.100.20",
		},
		{
			name:       "invalid cloudflare header",
			remoteAddr: "[::1]:43120",
			headerIP:   "not-an-ip",
			want:       "::1",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/client-ip", nil)
			request.RemoteAddr = test.remoteAddr
			request.Header.Set("CF-Connecting-IP", test.headerIP)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if got := strings.TrimSpace(response.Body.String()); got != test.want {
				t.Fatalf("client IP = %q, want %q", got, test.want)
			}
		})
	}
}

func TestHealthRoutesSeparateLivenessAndReadiness(t *testing.T) {
	gin.SetMode(gin.TestMode)
	readyErr := error(nil)
	router := gin.New()
	registerHealthRoutes(router, func(context.Context) error {
		return readyErr
	})

	for _, path := range []string{"/health", "/livez", "/readyz"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", path, response.Code)
		}
	}

	readyErr = errors.New("database unavailable")
	for _, path := range []string{"/health", "/readyz"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s status = %d, want 503", path, response.Code)
		}
		if strings.Contains(response.Body.String(), readyErr.Error()) {
			t.Fatalf("%s exposed dependency error: %q", path, response.Body.String())
		}
	}

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/livez", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("/livez status = %d, want 200 during dependency failure", response.Code)
	}
}

func TestCORSAllowsIdempotencyKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORSMiddleware())
	router.OPTIONS("/api/public/table-orders/:token/submit", func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(
		http.MethodOptions,
		"/api/public/table-orders/private-token/submit",
		nil,
	)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", response.Code)
	}
	if !strings.Contains(response.Header().Get("Access-Control-Allow-Headers"), "Idempotency-Key") {
		t.Fatalf(
			"Access-Control-Allow-Headers = %q, want Idempotency-Key",
			response.Header().Get("Access-Control-Allow-Headers"),
		)
	}
}

// A response that differs by Origin must say so on every request, not only
// the ones that carry an Origin. The menu image's thumbnail loads it as a
// plain <img>/CSS background (no Origin, so no Allow-Origin); without Vary the
// browser reused that cached copy for the cropper's crossOrigin load, which
// then failed CORS and showed "could not open this image".
func TestCORSVariesByOriginEvenWithoutOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(CORSMiddleware())
	router.GET("/uploads/menu/1/dish.webp", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	for _, origin := range []string{"", "http://localhost:3000"} {
		request := httptest.NewRequest(http.MethodGet, "/uploads/menu/1/dish.webp", nil)
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)

		if got := response.Header().Values("Vary"); len(got) != 1 || got[0] != "Origin" {
			t.Fatalf("origin %q: Vary = %q, want exactly [Origin]", origin, got)
		}
	}
}

func TestHTTPServerHasDefensiveTimeoutsWithoutBreakingStreams(t *testing.T) {
	server := newHTTPServer("127.0.0.1:8080", http.NewServeMux())

	if server.ReadHeaderTimeout <= 0 || server.ReadTimeout <= 0 || server.IdleTimeout <= 0 {
		t.Fatalf(
			"server timeouts must be positive: read_header=%s read=%s idle=%s",
			server.ReadHeaderTimeout,
			server.ReadTimeout,
			server.IdleTimeout,
		)
	}
	if server.WriteTimeout != 0 {
		t.Fatalf("global write timeout = %s, want 0 for SSE support", server.WriteTimeout)
	}
	if server.MaxHeaderBytes <= 0 {
		t.Fatalf("MaxHeaderBytes = %d, want positive limit", server.MaxHeaderBytes)
	}
	if server.ReadHeaderTimeout > 10*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s, want at most 10s", server.ReadHeaderTimeout)
	}
}
