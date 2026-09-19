package config

import (
	"fmt"
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

// TestPromotionsMigrationUpgradesAVersion31Database runs migration 32 over a
// schema shaped the way version 31 left it - every table but the three
// promotion ones, and order_items without discount_amount - twice, the second
// run standing in for a restart after a half-finished first one.
func TestPromotionsMigrationUpgradesAVersion31Database(t *testing.T) {
	db := migrationIntegrationDBOrSkip(t)

	var version31 []any
	for _, model := range SchemaModels() {
		switch model.(type) {
		case *entity.Promotion, *entity.PromotionTarget, *entity.OrderPromotion:
			continue
		}
		version31 = append(version31, model)
	}
	if err := db.AutoMigrate(version31...); err != nil {
		t.Fatalf("build the version 31 schema: %v", err)
	}
	if err := db.Exec(`ALTER TABLE order_items DROP COLUMN discount_amount`).Error; err != nil {
		t.Fatalf("remove the column version 31 did not have: %v", err)
	}
	for _, table := range []string{"promotions", "promotion_targets", "order_promotions"} {
		if db.Migrator().HasTable(table) {
			t.Fatalf("%s exists before migration 32 ran", table)
		}
	}

	plan := schemaMigrationPlan()
	migration := plan[len(plan)-1]
	if migration.Version != 32 || migration.Name != "promotions" {
		t.Fatalf("last migration = %d %q, want 32 promotions", migration.Version, migration.Name)
	}
	for run := 1; run <= 2; run++ {
		if err := migration.Up(&MigrationContext{DB: db}); err != nil {
			t.Fatalf("migration 32, run %d: %v", run, err)
		}
	}

	for _, table := range []string{"promotions", "promotion_targets", "order_promotions"} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("migration 32 did not create %s", table)
		}
	}
	for _, link := range promotionForeignKeys {
		if !db.Migrator().HasConstraint(link.model, link.association) {
			t.Fatalf("migration 32 left out the %T %s link", link.model, link.association)
		}
	}
	// Counted straight from the catalogue, so a link dropped from
	// promotionForeignKeys itself still fails here.
	for table, want := range map[string]int64{"promotions": 1, "promotion_targets": 3, "order_promotions": 2} {
		var got int64
		err := db.Raw(`SELECT COUNT(*) FROM information_schema.table_constraints
			WHERE table_schema = CURRENT_SCHEMA() AND table_name = ? AND constraint_type = 'FOREIGN KEY'`, table).
			Scan(&got).Error
		if err != nil {
			t.Fatalf("count %s foreign keys: %v", table, err)
		}
		if got != want {
			t.Fatalf("%s has %d foreign keys, want %d", table, got, want)
		}
	}
	if !db.Migrator().HasColumn(&entity.OrderItem{}, "discount_amount") {
		t.Fatal("migration 32 did not add order_items.discount_amount")
	}
	if !db.Migrator().HasConstraint(&entity.OrderItem{}, "chk_order_items_discount_nonnegative") {
		t.Fatal("order_items.discount_amount has no non-negative check")
	}
	if !db.Migrator().HasConstraint(&entity.PromotionTarget{}, "chk_promotion_targets_one_subject") {
		t.Fatal("a promotion target can name both a dish and a category")
	}

	var manager entity.Role
	if err := db.Where("name = ? AND restaurant_id IS NULL", "manager").First(&manager).Error; err != nil {
		t.Fatalf("load the manager system role: %v", err)
	}
	if !strings.Contains(manager.Permissions, `"manage_promotions"`) {
		t.Fatalf("manager permissions = %s, want manage_promotions", manager.Permissions)
	}
}
