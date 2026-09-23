package controller

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"Project-M/config"
	"Project-M/internal/entity"
	"Project-M/internal/repository"
	"Project-M/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// The table-management endpoints against PostgreSQL, through the real
// controller, service and repository: a table in service answers 409
// {"error":"table is in use"} on every one of them, and a free or switched-off
// table goes through. Skips unless RESERVATION_DB_TEST_ENABLED=1, the flag the
// service package's table tests use; each run works in its own temporary
// schema and drops it afterwards.

var tableLockSchemaPattern = regexp.MustCompile(`^table_lock_test_[0-9]+$`)

var (
	tableLockSettingsOnce sync.Once
	tableLockSettings     map[string]string
)

// tableLockSetting prefers a real environment variable and falls back to
// backend/.env, read into a private map so no key in that file leaks into the
// environment the rest of this package's tests run in.
func tableLockSetting(key string) string {
	tableLockSettingsOnce.Do(func() {
		values, err := godotenv.Read(filepath.Join("..", "..", ".env"))
		if err == nil {
			tableLockSettings = values
		}
	})
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return strings.TrimSpace(tableLockSettings[key])
}

func openTableLockDB(t *testing.T, searchPath string) *gorm.DB {
	t.Helper()
	port := tableLockSetting("DB_PORT")
	if port == "" {
		port = "5432"
	}
	sslMode := tableLockSetting("DB_SSLMODE")
	if sslMode == "" {
		sslMode = "disable"
	}
	dsn := &url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(tableLockSetting("DB_USER"), tableLockSetting("DB_PASSWORD")),
		Host:   net.JoinHostPort(tableLockSetting("DB_HOST"), port),
		Path:   tableLockSetting("DB_NAME"),
	}
	query := dsn.Query()
	query.Set("sslmode", sslMode)
	if searchPath != "" {
		query.Set("search_path", searchPath)
	}
	dsn.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(dsn.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open table lock test database: %v", err)
	}
	return db
}

func tableLockDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("RESERVATION_DB_TEST_ENABLED") != "1" {
		t.Skip("set RESERVATION_DB_TEST_ENABLED=1 to run PostgreSQL table-management endpoint tests")
	}
	for _, key := range []string{"DB_HOST", "DB_USER", "DB_NAME"} {
		if tableLockSetting(key) == "" {
			t.Skipf("table-management endpoint tests enabled, but %s is not configured", key)
		}
	}
	schema := fmt.Sprintf("table_lock_test_%d", time.Now().UnixNano())
	if !tableLockSchemaPattern.MatchString(schema) {
		t.Fatalf("unsafe temporary schema name %q", schema)
	}
	admin := openTableLockDB(t, "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create temporary schema: %v", err)
	}
	db := openTableLockDB(t, schema)
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		if err := admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop temporary schema: %v", err)
		}
		if sqlDB, err := admin.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(config.SchemaModels()...); err != nil {
		t.Fatalf("migrate temporary schema: %v", err)
	}
	return db
}

type tableLockAPI struct {
	db         *gorm.DB
	router     *gin.Engine
	tables     *service.TableService
	orders     *service.OrderService
	restaurant entity.Restaurant
	user       entity.User
	sequence   int
}

func newTableLockAPI(t *testing.T) *tableLockAPI {
	t.Helper()
	db := tableLockDB(t)
	suffix := time.Now().UnixNano()
	user := entity.User{
		Email:        fmt.Sprintf("table-lock-%d@example.invalid", suffix),
		AuthProvider: "local",
		FirstName:    "Table",
		LastName:     "Lock",
		Status:       "active",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	restaurant := entity.Restaurant{Name: "Table lock endpoint test", OwnerID: user.ID}
	if err := db.Create(&restaurant).Error; err != nil {
		t.Fatalf("create restaurant: %v", err)
	}

	gin.SetMode(gin.TestMode)
	router := gin.New()
	// What RestaurantScope leaves on the context for a member allowed to
	// manage tables.
	router.Use(func(c *gin.Context) {
		c.Set("user_id", user.ID)
		c.Set("restaurant_id", restaurant.ID)
		c.Set("restaurant_member", &entity.RestaurantMember{
			UserID:       user.ID,
			RestaurantID: restaurant.ID,
			Role:         &entity.Role{Name: "custom", Permissions: `["manage_table","view_tables","take_order"]`},
		})
		c.Next()
	})
	ctrl := ProvideTableController(db)
	// The same paths routes/menu_table.go registers.
	router.PUT("/api/v1/tables/:id", ctrl.UpdateTable)
	router.PATCH("/api/v1/tables/:id/status", ctrl.UpdateTableStatus)
	router.PATCH("/api/v1/tables/:id/move-zone", ctrl.MoveTableZone)
	router.DELETE("/api/v1/tables/:id", ctrl.DeleteTable)
	router.POST("/api/v1/tables/:id/regenerate-customer-token", ctrl.RegenerateCustomerToken)
	router.PUT("/api/v1/table-zones/:id", ctrl.UpdateZone)

	return &tableLockAPI{
		db:         db,
		router:     router,
		tables:     service.ProvideTableService(repository.NewTableRepository(db)),
		orders:     service.ProvideOrderService(repository.NewOrderRepository(db)),
		restaurant: restaurant,
		user:       user,
	}
}

func (api *tableLockAPI) do(t *testing.T, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			t.Fatalf("encode body: %v", err)
		}
	}
	request := httptest.NewRequest(method, path, &payload)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	api.router.ServeHTTP(recorder, request)
	return recorder
}

func (api *tableLockAPI) table(t *testing.T, status string) entity.RestaurantTable {
	t.Helper()
	api.sequence++
	label := fmt.Sprintf("T%d", api.sequence)
	table := entity.RestaurantTable{
		RestaurantID:   api.restaurant.ID,
		TableNumber:    label,
		DisplayLabel:   label,
		SequenceNumber: api.sequence,
		Capacity:       4,
		Status:         status,
		CustomerToken:  fmt.Sprintf("table-lock-%d-%d", time.Now().UnixNano(), api.sequence),
	}
	if err := api.db.Create(&table).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	return table
}

func (api *tableLockAPI) seat(t *testing.T, tableID uint) entity.Order {
	t.Helper()
	id := tableID
	order, err := api.orders.OpenOrder(api.restaurant.ID, api.user.ID, &service.OpenOrderRequest{
		TableID:       &id,
		OrderType:     entity.OrderTypeDineIn,
		CustomerCount: 2,
	})
	if err != nil {
		t.Fatalf("open order: %v", err)
	}
	return *order
}

func (api *tableLockAPI) hold(t *testing.T, tableID uint) {
	t.Helper()
	if _, err := api.tables.ReserveTable(api.restaurant.ID, api.user.ID, tableID, "0812345678", "Held guest", 2, nil); err != nil {
		t.Fatalf("hold table: %v", err)
	}
}

func (api *tableLockAPI) zone(t *testing.T, name, prefix string) entity.TableZone {
	t.Helper()
	zone, err := api.tables.CreateZone(api.restaurant.ID, &service.TableZoneRequest{Name: name, Prefix: prefix})
	if err != nil {
		t.Fatalf("create zone: %v", err)
	}
	return *zone
}

func assertTableInUseResponse(t *testing.T, recorder *httptest.ResponseRecorder) {
	t.Helper()
	if recorder.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d (body %s)", recorder.Code, http.StatusConflict, recorder.Body.String())
	}
	var response struct {
		Error string `json:"error"`
		Code  string `json:"code"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if response.Error != "table is in use" || response.Code != "conflict" {
		t.Fatalf("body = %+v, want error %q code %q", response, "table is in use", "conflict")
	}
}

type tableLockEndpoint struct {
	name string
	call func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder
}

func tableLockEndpoints(zoneID uint) []tableLockEndpoint {
	return []tableLockEndpoint{
		{name: "PUT /tables/:id", call: func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder {
			return api.do(t, http.MethodPut, fmt.Sprintf("/api/v1/tables/%d", tableID), map[string]any{"capacity": 6, "status": "inactive"})
		}},
		{name: "PATCH /tables/:id/status inactive", call: func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder {
			return api.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/tables/%d/status", tableID), map[string]any{"status": "inactive"})
		}},
		{name: "PATCH /tables/:id/move-zone", call: func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder {
			return api.do(t, http.MethodPatch, fmt.Sprintf("/api/v1/tables/%d/move-zone", tableID), map[string]any{"zone_id": zoneID})
		}},
		{name: "POST /tables/:id/regenerate-customer-token", call: func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder {
			return api.do(t, http.MethodPost, fmt.Sprintf("/api/v1/tables/%d/regenerate-customer-token", tableID), nil)
		}},
		{name: "DELETE /tables/:id", call: func(t *testing.T, api *tableLockAPI, tableID uint) *httptest.ResponseRecorder {
			return api.do(t, http.MethodDelete, fmt.Sprintf("/api/v1/tables/%d", tableID), nil)
		}},
	}
}

func TestTableManagementEndpointsAnswerTableInUseWithConflict(t *testing.T) {
	api := newTableLockAPI(t)
	zone := api.zone(t, "Garden", "G")
	states := []struct {
		name  string
		setup func(t *testing.T) uint
	}{
		{name: "seated", setup: func(t *testing.T) uint {
			table := api.table(t, entity.TableStatusFree)
			api.seat(t, table.ID)
			return table.ID
		}},
		{name: "held", setup: func(t *testing.T) uint {
			table := api.table(t, entity.TableStatusFree)
			api.hold(t, table.ID)
			return table.ID
		}},
	}
	for _, state := range states {
		for _, endpoint := range tableLockEndpoints(zone.ID) {
			t.Run(state.name+" "+endpoint.name, func(t *testing.T) {
				tableID := state.setup(t)
				assertTableInUseResponse(t, endpoint.call(t, api, tableID))
			})
		}
	}
}

func TestTableManagementEndpointsEditFreeAndInactiveTables(t *testing.T) {
	api := newTableLockAPI(t)
	zone := api.zone(t, "Garden", "G")
	for _, status := range []string{entity.TableStatusFree, entity.TableStatusInactive} {
		for _, endpoint := range tableLockEndpoints(zone.ID) {
			t.Run(status+" "+endpoint.name, func(t *testing.T) {
				table := api.table(t, status)
				recorder := endpoint.call(t, api, table.ID)
				if recorder.Code != http.StatusOK {
					t.Fatalf("status = %d, want %d (body %s)", recorder.Code, http.StatusOK, recorder.Body.String())
				}
			})
		}
	}
}

func TestZoneEndpointRefusesARelabelWhileATableInItIsInService(t *testing.T) {
	api := newTableLockAPI(t)
	zone := api.zone(t, "Patio", "P")
	zoneID := zone.ID
	busy, err := api.tables.CreateTable(api.restaurant.ID, &service.TableRequest{ZoneID: &zoneID, Capacity: 4})
	if err != nil {
		t.Fatalf("create busy table: %v", err)
	}
	if _, err := api.tables.CreateTable(api.restaurant.ID, &service.TableRequest{ZoneID: &zoneID, Capacity: 4, Status: entity.TableStatusInactive}); err != nil {
		t.Fatalf("create inactive table: %v", err)
	}
	order := api.seat(t, busy.ID)
	path := fmt.Sprintf("/api/v1/table-zones/%d", zone.ID)

	assertTableInUseResponse(t, api.do(t, http.MethodPut, path, map[string]any{"name": "Patio", "prefix": "Q", "display_order": 0}))

	if recorder := api.do(t, http.MethodPut, path, map[string]any{"name": "Terrace", "prefix": "P", "display_order": 2}); recorder.Code != http.StatusOK {
		t.Fatalf("rename status = %d, want %d (body %s)", recorder.Code, http.StatusOK, recorder.Body.String())
	}

	if _, err := api.orders.CloseEmptyTable(api.restaurant.ID, api.user.ID, order.ID); err != nil {
		t.Fatalf("close empty table: %v", err)
	}
	if recorder := api.do(t, http.MethodPut, path, map[string]any{"name": "Terrace", "prefix": "Q", "display_order": 2}); recorder.Code != http.StatusOK {
		t.Fatalf("relabel after the table left service status = %d, want %d (body %s)", recorder.Code, http.StatusOK, recorder.Body.String())
	}
}
