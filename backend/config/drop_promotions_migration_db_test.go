package config

import (
	"fmt"
	"math"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var migrationTestSchemaPattern = regexp.MustCompile(`^migration_test_[0-9]+$`)

// migrationIntegrationDBOrSkip opens the development database inside a fresh,
// empty schema that is dropped when the test ends, so a migration can be run
// against real PostgreSQL without touching any real table. It runs under the
// same flag as the service package's order transaction tests.
func migrationIntegrationDBOrSkip(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("ORDER_DB_INTEGRATION_ENABLED") != "1" {
		t.Skip("set ORDER_DB_INTEGRATION_ENABLED=1 to run PostgreSQL migration tests")
	}
	_ = godotenv.Load(filepath.Join("..", ".env"))
	for _, key := range []string{"DB_HOST", "DB_USER", "DB_NAME"} {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			t.Fatalf("%s is required for PostgreSQL migration tests", key)
		}
	}
	port := strings.TrimSpace(os.Getenv("DB_PORT"))
	if port == "" {
		port = "5432"
	}
	sslMode := strings.TrimSpace(os.Getenv("DB_SSLMODE"))
	if sslMode == "" {
		sslMode = "disable"
	}
	databaseURL := url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(os.Getenv("DB_USER"), os.Getenv("DB_PASSWORD")),
		Host:   net.JoinHostPort(os.Getenv("DB_HOST"), port),
		Path:   "/" + os.Getenv("DB_NAME"),
	}
	query := databaseURL.Query()
	query.Set("sslmode", sslMode)
	databaseURL.RawQuery = query.Encode()

	quiet := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	baseDB, err := gorm.Open(postgres.Open(databaseURL.String()), quiet)
	if err != nil {
		t.Fatal("open PostgreSQL migration test database")
	}
	baseSQLDB, err := baseDB.DB()
	if err != nil {
		t.Fatal("access PostgreSQL migration test connection pool")
	}
	t.Cleanup(func() { _ = baseSQLDB.Close() })

	schemaName := fmt.Sprintf("migration_test_%d", time.Now().UnixNano())
	if !migrationTestSchemaPattern.MatchString(schemaName) {
		t.Fatalf("unsafe temporary migration test schema name %q", schemaName)
	}
	if err := baseDB.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
		t.Fatal("create isolated PostgreSQL migration test schema")
	}
	t.Cleanup(func() {
		if err := baseDB.Exec(`DROP SCHEMA IF EXISTS "` + schemaName + `" CASCADE`).Error; err != nil {
			t.Error("drop isolated PostgreSQL migration test schema")
		}
	})

	query.Set("search_path", schemaName)
	databaseURL.RawQuery = query.Encode()
	testDB, err := gorm.Open(postgres.Open(databaseURL.String()), quiet)
	if err != nil {
		t.Fatal("open isolated PostgreSQL migration test schema")
	}
	testSQLDB, err := testDB.DB()
	if err != nil {
		t.Fatal("access isolated PostgreSQL migration test connection pool")
	}
	t.Cleanup(func() { _ = testSQLDB.Close() })
	return testDB
}

// version37PromotionTables recreates what migrations 32 and 37 left behind,
// in the shape that matters to migration 38: the three promotion tables with
// their links, and order_items.promotion_free_id.
var version37PromotionTables = []string{
	`CREATE TABLE promotions (id BIGSERIAL PRIMARY KEY, restaurant_id BIGINT NOT NULL REFERENCES restaurants(id), name TEXT NOT NULL)`,
	`CREATE TABLE promotion_targets (id BIGSERIAL PRIMARY KEY, promotion_id BIGINT NOT NULL REFERENCES promotions(id))`,
	`CREATE TABLE order_promotions (id BIGSERIAL PRIMARY KEY, order_id BIGINT NOT NULL REFERENCES orders(id), promotion_id BIGINT NOT NULL REFERENCES promotions(id), amount NUMERIC(14,2) NOT NULL)`,
	`ALTER TABLE order_items ADD COLUMN promotion_free_id BIGINT`,
}

type dropPromotionsScenario struct {
	db         *gorm.DB
	restaurant entity.Restaurant
	user       entity.User
	menu       entity.MenuItem
	orders     int
}

func (s *dropPromotionsScenario) create(t *testing.T, value any) {
	t.Helper()
	if err := s.db.Create(value).Error; err != nil {
		t.Fatalf("create %T: %v", value, err)
	}
}

func (s *dropPromotionsScenario) order(t *testing.T, paid bool, discount, grandTotal float64) entity.Order {
	t.Helper()
	s.orders++
	now := time.Now()
	order := entity.Order{
		RestaurantID:   s.restaurant.ID,
		OrderType:      entity.OrderTypeTakeaway,
		OrderNumber:    fmt.Sprintf("20260929-%03d", s.orders),
		OrderDate:      "2026-09-29",
		StaffID:        s.user.ID,
		CustomerCount:  1,
		Status:         entity.OrderStatusCooking,
		Subtotal:       350,
		DiscountAmount: discount,
		TotalAmount:    350 - discount,
		GrandTotal:     grandTotal,
		PaymentStatus:  entity.PaymentStatusUnpaid,
		OpenedAt:       now,
	}
	if paid {
		order.Status = entity.OrderStatusCompleted
		order.PaymentStatus = entity.PaymentStatusPaid
	}
	s.create(t, &order)
	return order
}

func (s *dropPromotionsScenario) line(t *testing.T, order entity.Order, subtotal, discount float64, status string) entity.OrderItem {
	t.Helper()
	item := entity.OrderItem{
		OrderID:         order.ID,
		RestaurantID:    s.restaurant.ID,
		MenuID:          s.menu.ID,
		MenuName:        s.menu.Name,
		UnitPrice:       subtotal,
		Quantity:        1,
		Subtotal:        subtotal,
		DiscountAmount:  discount,
		FulfillmentType: entity.OrderItemFulfillmentTakeaway,
		Status:          status,
	}
	s.create(t, &item)
	return item
}

// TestDropPromotionsMigrationRepricesOpenBillsAndKeepsPaidOnes runs migration
// 38 over a version 37 database twice, the second run standing in for a
// restart after a half-finished first one and for a new database that never
// had the promotion tables.
func TestDropPromotionsMigrationRepricesOpenBillsAndKeepsPaidOnes(t *testing.T) {
	db := migrationIntegrationDBOrSkip(t)
	if err := db.AutoMigrate(SchemaModels()...); err != nil {
		t.Fatalf("build the schema: %v", err)
	}
	for _, statement := range version37PromotionTables {
		if err := db.Exec(statement).Error; err != nil {
			t.Fatalf("recreate the version 37 promotion tables: %v", err)
		}
	}

	s := &dropPromotionsScenario{db: db}
	s.user = entity.User{Email: "drop-promotions@example.invalid", AuthProvider: "local", FirstName: "Drop", LastName: "Tester", Status: "active"}
	s.create(t, &s.user)
	s.restaurant = entity.Restaurant{Name: "Drop promotions", OwnerID: s.user.ID, ServiceChargeEnabled: true, ServiceChargeRate: 10, VATEnabled: true, VATRate: 7}
	s.create(t, &s.restaurant)
	category := entity.Category{RestaurantID: s.restaurant.ID, Name: "Food", IsActive: true}
	s.create(t, &category)
	s.menu = entity.MenuItem{RestaurantID: s.restaurant.ID, CategoryID: category.ID, Name: "Dish", Price: 100, IsAvailable: true}
	s.create(t, &s.menu)

	var promotionID uint
	if err := db.Raw(`INSERT INTO promotions (restaurant_id, name) VALUES (?, '1 แถม 1') RETURNING id`, s.restaurant.ID).Scan(&promotionID).Error; err != nil {
		t.Fatalf("insert a promotion: %v", err)
	}

	// An open bill priced by promotions: a dish discount, a free line, and a
	// cancelled line that counts for nothing.
	open := s.order(t, false, 120, 250)
	discounted := s.line(t, open, 200, 20, entity.OrderItemStatusCooking)
	free := s.line(t, open, 100, 100, entity.OrderItemStatusPending)
	s.line(t, open, 50, 0, entity.OrderItemStatusCancelled)
	if err := db.Exec(`UPDATE order_items SET promotion_free_id = ? WHERE id = ?`, promotionID, free.ID).Error; err != nil {
		t.Fatalf("mark the free line: %v", err)
	}
	if err := db.Exec(`INSERT INTO order_promotions (order_id, promotion_id, amount) VALUES (?, ?, 120)`, open.ID, promotionID).Error; err != nil {
		t.Fatalf("insert the applied promotion: %v", err)
	}
	// A paid bill keeps what it was paid under.
	paid := s.order(t, true, 30, 320)
	paidLine := s.line(t, paid, 350, 30, entity.OrderItemStatusServed)
	// An open bill promotions never touched is left alone.
	plain := s.order(t, false, 0, 999)
	s.line(t, plain, 350, 0, entity.OrderItemStatusCooking)

	custom := entity.Role{RestaurantID: &s.restaurant.ID, Name: "floor_lead", DisplayName: "Floor lead", Permissions: `["manage_menu","manage_promotions"]`}
	s.create(t, &custom)

	plan := schemaMigrationPlan()
	migration := plan[len(plan)-1]
	if migration.Version != 38 || migration.Name != "drop_promotions" {
		t.Fatalf("last migration = %d %q, want 38 drop_promotions", migration.Version, migration.Name)
	}
	for run := 1; run <= 2; run++ {
		if err := migration.Up(&MigrationContext{DB: db}); err != nil {
			t.Fatalf("migration 38, run %d: %v", run, err)
		}
	}

	for _, table := range []string{"promotions", "promotion_targets", "order_promotions"} {
		if db.Migrator().HasTable(table) {
			t.Fatalf("migration 38 left %s behind", table)
		}
	}
	if db.Migrator().HasColumn("order_items", "promotion_free_id") {
		t.Fatal("migration 38 left order_items.promotion_free_id behind")
	}

	near := func(got, want float64) bool { return math.Abs(got-want) < 0.005 }
	var repriced entity.Order
	if err := db.First(&repriced, open.ID).Error; err != nil {
		t.Fatalf("load the open bill: %v", err)
	}
	// 200 on the bill, 10% service = 20, 7% VAT on 220 = 15.40.
	if !near(repriced.Subtotal, 200) || !near(repriced.DiscountAmount, 0) || !near(repriced.TotalAmount, 200) ||
		!near(repriced.ServiceChargeAmount, 20) || !near(repriced.VATAmount, 15.40) || !near(repriced.GrandTotal, 235.40) {
		t.Fatalf("open bill = subtotal %.2f discount %.2f total %.2f service %.2f vat %.2f grand %.2f, want 200/0/200/20/15.40/235.40",
			repriced.Subtotal, repriced.DiscountAmount, repriced.TotalAmount, repriced.ServiceChargeAmount, repriced.VATAmount, repriced.GrandTotal)
	}
	var line entity.OrderItem
	if err := db.First(&line, discounted.ID).Error; err != nil || !near(line.DiscountAmount, 0) {
		t.Fatalf("the open bill's dish discount = %.2f (%v), want 0", line.DiscountAmount, err)
	}
	if err := db.First(&entity.OrderItem{}, free.ID).Error; err == nil {
		t.Fatal("the free line a promotion added is still on the open bill")
	}

	var kept entity.Order
	if err := db.First(&kept, paid.ID).Error; err != nil {
		t.Fatalf("load the paid bill: %v", err)
	}
	if !near(kept.DiscountAmount, 30) || !near(kept.GrandTotal, 320) {
		t.Fatalf("paid bill = discount %.2f grand %.2f, want 30 and 320 untouched", kept.DiscountAmount, kept.GrandTotal)
	}
	var paidItem entity.OrderItem
	if err := db.First(&paidItem, paidLine.ID).Error; err != nil || !near(paidItem.DiscountAmount, 30) {
		t.Fatalf("the paid bill's dish discount = %.2f (%v), want 30 untouched", paidItem.DiscountAmount, err)
	}
	var untouched entity.Order
	if err := db.First(&untouched, plain.ID).Error; err != nil || !near(untouched.GrandTotal, 999) {
		t.Fatalf("an open bill without promotions was repriced: grand %.2f (%v)", untouched.GrandTotal, err)
	}

	var role entity.Role
	if err := db.First(&role, custom.ID).Error; err != nil {
		t.Fatalf("load the custom role: %v", err)
	}
	if strings.Contains(role.Permissions, "manage_promotions") || !strings.Contains(role.Permissions, "manage_menu") {
		t.Fatalf("custom role permissions = %s, want manage_menu without manage_promotions", role.Permissions)
	}
}
