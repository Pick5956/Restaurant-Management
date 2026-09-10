package service

import (
	"fmt"
	"net"
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

	"github.com/joho/godotenv"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var reservationTestSchemaPattern = regexp.MustCompile(`^reservation_test_[0-9]+$`)

func reservationIntegrationDB(t *testing.T) *gorm.DB {
	t.Helper()
	if os.Getenv("RESERVATION_DB_TEST_ENABLED") != "1" {
		t.Skip("set RESERVATION_DB_TEST_ENABLED=1 to run PostgreSQL reservation transaction tests")
	}

	loadReservationDBSettings()
	for _, key := range []string{"DB_HOST", "DB_USER", "DB_NAME"} {
		if strings.TrimSpace(reservationDBSetting(key)) == "" {
			t.Skipf("reservation database tests enabled, but %s is not configured", key)
		}
	}

	schema := fmt.Sprintf("reservation_test_%d", time.Now().UnixNano())
	if !reservationTestSchemaPattern.MatchString(schema) {
		t.Fatalf("unsafe temporary schema name %q", schema)
	}
	admin := openReservationTestDB(t, "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatalf("create temporary reservation schema: %v", err)
	}

	db := openReservationTestDB(t, schema)
	t.Cleanup(func() {
		if sqlDB, err := db.DB(); err == nil {
			_ = sqlDB.Close()
		}
		if err := admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`).Error; err != nil {
			t.Errorf("drop temporary reservation schema: %v", err)
		}
		if sqlDB, err := admin.DB(); err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := db.AutoMigrate(config.SchemaModels()...); err != nil {
		t.Fatalf("migrate temporary reservation schema: %v", err)
	}
	return db
}

// loadReservationDBSettings reads .env into a private map instead of into the
// process environment.
//
// `godotenv.Load` used to be called here, which published every key in that file
// — including the AI provider keys — to the whole test binary. Tests that assert
// the app behaves correctly with no provider configured then saw one, and since
// they run with t.Parallel() alongside these, whether they passed depended on
// scheduling. Nothing outside this file needs those values, so nothing outside
// this file gets them.
func loadReservationDBSettings() {
	reservationDBSettingsOnce.Do(func() {
		values, err := godotenv.Read(filepath.Join("..", "..", ".env"))
		if err != nil {
			return
		}
		reservationDBSettings = values
	})
}

// reservationDBSetting prefers a real environment variable so CI can override
// the file, and falls back to what .env carried.
func reservationDBSetting(key string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return strings.TrimSpace(reservationDBSettings[key])
}

var (
	reservationDBSettingsOnce sync.Once
	reservationDBSettings     map[string]string
)

func openReservationTestDB(t *testing.T, searchPath string) *gorm.DB {
	t.Helper()
	port := reservationDBSetting("DB_PORT")
	if port == "" {
		port = "5432"
	}
	sslMode := reservationDBSetting("DB_SSLMODE")
	if sslMode == "" {
		sslMode = "disable"
	}
	dsn := &url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(reservationDBSetting("DB_USER"), reservationDBSetting("DB_PASSWORD")),
		Host:   net.JoinHostPort(reservationDBSetting("DB_HOST"), port),
		Path:   reservationDBSetting("DB_NAME"),
	}
	query := dsn.Query()
	query.Set("sslmode", sslMode)
	if searchPath != "" {
		query.Set("search_path", searchPath)
	}
	dsn.RawQuery = query.Encode()

	db, err := gorm.Open(postgres.Open(dsn.String()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("open reservation test database: %v", err)
	}
	return db
}

type reservationDBScenario struct {
	db         *gorm.DB
	tableSvc   *TableService
	orderSvc   *OrderService
	restaurant entity.Restaurant
	user       entity.User
}

func newReservationDBScenario(t *testing.T) *reservationDBScenario {
	t.Helper()
	db := reservationIntegrationDB(t)
	suffix := time.Now().UnixNano()
	user := entity.User{
		Email:        fmt.Sprintf("reservation-%d@example.invalid", suffix),
		AuthProvider: "local",
		FirstName:    "Reservation",
		LastName:     "Test",
		Status:       "active",
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("create reservation test user: %v", err)
	}
	restaurant := entity.Restaurant{Name: "Reservation transaction test", OwnerID: user.ID}
	if err := db.Create(&restaurant).Error; err != nil {
		t.Fatalf("create reservation test restaurant: %v", err)
	}
	return &reservationDBScenario{
		db:         db,
		tableSvc:   ProvideTableService(repository.NewTableRepository(db)),
		orderSvc:   ProvideOrderService(repository.NewOrderRepository(db)),
		restaurant: restaurant,
		user:       user,
	}
}

func (scenario *reservationDBScenario) table(t *testing.T, sequence int, status string) entity.RestaurantTable {
	t.Helper()
	label := fmt.Sprintf("T%d", sequence)
	table := entity.RestaurantTable{
		RestaurantID:   scenario.restaurant.ID,
		TableNumber:    label,
		DisplayLabel:   label,
		SequenceNumber: sequence,
		Capacity:       4,
		Status:         status,
		CustomerToken:  fmt.Sprintf("reservation-test-%d-%d", time.Now().UnixNano(), sequence),
	}
	if err := scenario.db.Create(&table).Error; err != nil {
		t.Fatalf("create reservation test table: %v", err)
	}
	return table
}

func (scenario *reservationDBScenario) duplicateActiveReservations(t *testing.T, table entity.RestaurantTable, count int) []entity.Reservation {
	t.Helper()
	reservations := make([]entity.Reservation, 0, count)
	for index := 1; index <= count; index++ {
		reservation := reservationForTable(
			&table,
			scenario.user.ID,
			fmt.Sprintf("08123456%02d", index),
			fmt.Sprintf("Legacy guest %d", index),
		)
		if err := scenario.db.Create(reservation).Error; err != nil {
			t.Fatalf("seed duplicate active reservation %d: %v", index, err)
		}
		reservations = append(reservations, *reservation)
	}
	return reservations
}

func TestLegacyTableStatusPersistsReservationLifecycle(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)

	updated, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusReserved,
		"081-234-5678",
		"Legacy guest",
	)
	if err != nil {
		t.Fatalf("reserve through legacy status endpoint: %v", err)
	}
	if updated.Status != entity.TableStatusReserved {
		t.Fatalf("table status = %q, want reserved", updated.Status)
	}

	var reservation entity.Reservation
	if err := scenario.db.Where(
		"restaurant_id = ? AND table_id = ? AND status = ?",
		scenario.restaurant.ID,
		table.ID,
		entity.ReservationStatusActive,
	).First(&reservation).Error; err != nil {
		t.Fatalf("find active reservation created by legacy status endpoint: %v", err)
	}
	if reservation.ReservedByUserID != scenario.user.ID {
		t.Fatalf("reserved_by_user_id = %d, want %d", reservation.ReservedByUserID, scenario.user.ID)
	}

	if _, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusFree,
		"",
		"",
	); err != nil {
		t.Fatalf("release through legacy status endpoint: %v", err)
	}
	if err := scenario.db.First(&reservation, reservation.ID).Error; err != nil {
		t.Fatalf("reload resolved reservation: %v", err)
	}
	if reservation.Status != entity.ReservationStatusCancelled || reservation.ResolvedAt == nil {
		t.Fatalf("reservation = status %q resolved_at %v, want cancelled with timestamp", reservation.Status, reservation.ResolvedAt)
	}
}

func TestLegacyTableStatusCannotSeatReservationWithoutOpeningOrder(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Arriving guest",
		2,
		nil,
	); err != nil {
		t.Fatalf("reserve table: %v", err)
	}

	_, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusOccupied,
		"",
		"",
	)
	if err == nil || err.Error() != "reservation seating requires opening an order" {
		t.Fatalf("UpdateTableStatus() error = %v, want atomic seating requirement", err)
	}

	var persistedTable entity.RestaurantTable
	if err := scenario.db.First(&persistedTable, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if persistedTable.Status != entity.TableStatusReserved {
		t.Fatalf("table status = %q, want reserved", persistedTable.Status)
	}
	var activeReservations int64
	if err := scenario.db.Model(&entity.Reservation{}).
		Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
		Count(&activeReservations).Error; err != nil {
		t.Fatalf("count active reservations: %v", err)
	}
	if activeReservations != 1 {
		t.Fatalf("active reservations = %d, want 1", activeReservations)
	}
}

func TestLegacyTableStatusCannotOccupyFreeTableWithoutOpenOrder(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)

	_, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusOccupied,
		"",
		"",
	)
	if err == nil || err.Error() != "table occupation requires opening an order" {
		t.Fatalf("UpdateTableStatus() error = %v, want order lifecycle requirement", err)
	}

	var persistedTable entity.RestaurantTable
	if err := scenario.db.First(&persistedTable, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if persistedTable.Status != entity.TableStatusFree {
		t.Fatalf("table status = %q, want free", persistedTable.Status)
	}
}

func TestLegacyTableStatusResolvesPreviouslyOrphanedActiveReservation(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	reservation := reservationForTable(&table, scenario.user.ID, "0812345678", "Legacy orphan")
	if err := scenario.db.Create(reservation).Error; err != nil {
		t.Fatalf("seed orphaned active reservation: %v", err)
	}

	if _, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusFree,
		"",
		"",
	); err != nil {
		t.Fatalf("repair orphaned active reservation: %v", err)
	}

	if err := scenario.db.First(reservation, reservation.ID).Error; err != nil {
		t.Fatalf("reload repaired reservation: %v", err)
	}
	if reservation.Status != entity.ReservationStatusCancelled || reservation.ResolvedAt == nil {
		t.Fatalf("reservation = status %q resolved_at %v, want cancelled with timestamp", reservation.Status, reservation.ResolvedAt)
	}
}

func TestReserveTableReusesStaleActiveReservation(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	orphaned := reservationForTable(&table, scenario.user.ID, "0800000000", "Old guest")
	if err := scenario.db.Create(orphaned).Error; err != nil {
		t.Fatalf("seed stale active reservation: %v", err)
	}

	actor := entity.User{
		Email:        fmt.Sprintf("reservation-actor-%d@example.invalid", time.Now().UnixNano()),
		AuthProvider: "local",
		FirstName:    "New",
		LastName:     "Actor",
		Status:       "active",
	}
	if err := scenario.db.Create(&actor).Error; err != nil {
		t.Fatalf("create reservation actor: %v", err)
	}

	updated, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		actor.ID,
		table.ID,
		"0812345678",
		"Current guest",
		2,
		nil,
	)
	if err != nil {
		t.Fatalf("reserve table with stale active lifecycle: %v", err)
	}
	if updated.Status != entity.TableStatusReserved {
		t.Fatalf("table status = %q, want reserved", updated.Status)
	}

	var activeReservations []entity.Reservation
	if err := scenario.db.Where(
		"restaurant_id = ? AND table_id = ? AND status = ?",
		scenario.restaurant.ID,
		table.ID,
		entity.ReservationStatusActive,
	).Find(&activeReservations).Error; err != nil {
		t.Fatalf("list active reservations: %v", err)
	}
	if len(activeReservations) != 1 {
		t.Fatalf("active reservations = %d, want exactly 1", len(activeReservations))
	}
	reservation := activeReservations[0]
	if reservation.ID != orphaned.ID {
		t.Fatalf("reservation id = %d, want reused row %d", reservation.ID, orphaned.ID)
	}
	if reservation.Name != "Current guest" || reservation.Phone != "0812345678" {
		t.Fatalf("reservation details = %q/%q, want current guest details", reservation.Name, reservation.Phone)
	}
	if reservation.ReservedByUserID != actor.ID {
		t.Fatalf("reserved_by_user_id = %d, want acting user %d", reservation.ReservedByUserID, actor.ID)
	}

	tableID := table.ID
	if _, err := scenario.orderSvc.OpenOrder(
		scenario.restaurant.ID,
		actor.ID,
		&OpenOrderRequest{
			TableID:         &tableID,
			OrderType:       entity.OrderTypeDineIn,
			CustomerCount:   2,
			SeatReservation: true,
		},
	); err != nil {
		t.Fatalf("seat reused reservation atomically: %v", err)
	}
	if err := scenario.db.First(&reservation, reservation.ID).Error; err != nil {
		t.Fatalf("reload seated reservation: %v", err)
	}
	if reservation.Status != entity.ReservationStatusSeated || reservation.ResolvedAt == nil {
		t.Fatalf("reservation = status %q resolved_at %v, want seated with timestamp", reservation.Status, reservation.ResolvedAt)
	}
}

func TestTableMetadataWritesCannotCreateLifecycleStatuses(t *testing.T) {
	scenario := newReservationDBScenario(t)

	for _, status := range []string{entity.TableStatusReserved, entity.TableStatusOccupied} {
		if _, err := scenario.tableSvc.CreateTable(scenario.restaurant.ID, &TableRequest{
			Capacity: 4,
			Status:   status,
		}); err == nil || err.Error() != "table status must be free or inactive" {
			t.Fatalf("CreateTable(status=%q) error = %v, want availability-only error", status, err)
		}

		if _, err := scenario.tableSvc.BulkCreateTables(scenario.restaurant.ID, &BulkCreateTablesRequest{
			Count:    2,
			Capacity: 4,
			Status:   status,
		}); err == nil || err.Error() != "table status must be free or inactive" {
			t.Fatalf("BulkCreateTables(status=%q) error = %v, want availability-only error", status, err)
		}
	}

	table := scenario.table(t, 1, entity.TableStatusFree)
	for _, status := range []string{entity.TableStatusReserved, entity.TableStatusOccupied} {
		if _, err := scenario.tableSvc.UpdateTable(scenario.restaurant.ID, table.ID, &TableRequest{
			Capacity: 6,
			Status:   status,
		}); err == nil || err.Error() != "table status must be free or inactive" {
			t.Fatalf("UpdateTable(status=%q) error = %v, want availability-only error", status, err)
		}
	}

	var persisted entity.RestaurantTable
	if err := scenario.db.First(&persisted, table.ID).Error; err != nil {
		t.Fatalf("reload metadata table: %v", err)
	}
	if persisted.Status != entity.TableStatusFree || persisted.Capacity != 4 {
		t.Fatalf("table after rejected lifecycle metadata = status %q capacity %d, want free/4", persisted.Status, persisted.Capacity)
	}
}

func TestTableMetadataUpdatePreservesExistingLifecycleStatuses(t *testing.T) {
	scenario := newReservationDBScenario(t)

	reservedTable := scenario.table(t, 1, entity.TableStatusFree)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		reservedTable.ID,
		"0812345678",
		"Reserved guest",
		2,
		nil,
	); err != nil {
		t.Fatalf("reserve table: %v", err)
	}
	reservedUpdated, err := scenario.tableSvc.UpdateTable(scenario.restaurant.ID, reservedTable.ID, &TableRequest{
		Capacity: 6,
		Status:   entity.TableStatusFree,
	})
	if err != nil {
		t.Fatalf("update reserved table metadata: %v", err)
	}
	if reservedUpdated.Status != entity.TableStatusReserved || reservedUpdated.Capacity != 6 {
		t.Fatalf("reserved metadata update = status %q capacity %d, want reserved/6", reservedUpdated.Status, reservedUpdated.Capacity)
	}
	if reservedUpdated.ReservationPhone != "0812345678" || reservedUpdated.ReservationName != "Reserved guest" {
		t.Fatalf("reserved metadata was cleared: %+v", reservedUpdated)
	}

	occupiedTable := scenario.table(t, 2, entity.TableStatusFree)
	occupiedTableID := occupiedTable.ID
	if _, err := scenario.orderSvc.OpenOrder(
		scenario.restaurant.ID,
		scenario.user.ID,
		&OpenOrderRequest{
			TableID:       &occupiedTableID,
			OrderType:     entity.OrderTypeDineIn,
			CustomerCount: 2,
		},
	); err != nil {
		t.Fatalf("open table order: %v", err)
	}
	occupiedUpdated, err := scenario.tableSvc.UpdateTable(scenario.restaurant.ID, occupiedTable.ID, &TableRequest{
		Capacity: 8,
		Status:   entity.TableStatusInactive,
	})
	if err != nil {
		t.Fatalf("update occupied table metadata: %v", err)
	}
	if occupiedUpdated.Status != entity.TableStatusOccupied || occupiedUpdated.Capacity != 8 {
		t.Fatalf("occupied metadata update = status %q capacity %d, want occupied/8", occupiedUpdated.Status, occupiedUpdated.Capacity)
	}
}

func TestDeleteTableRejectsActiveReservation(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Waiting guest",
		2,
		nil,
	); err != nil {
		t.Fatalf("reserve table: %v", err)
	}

	if err := scenario.tableSvc.DeleteTable(scenario.restaurant.ID, table.ID); err == nil || err.Error() != "table has an active reservation; cancel it first" {
		t.Fatalf("DeleteTable() error = %v, want active reservation conflict", err)
	}

	var persisted entity.RestaurantTable
	if err := scenario.db.First(&persisted, table.ID).Error; err != nil {
		t.Fatalf("table was deleted despite active reservation: %v", err)
	}
	var activeCount int64
	if err := scenario.db.Model(&entity.Reservation{}).
		Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
		Count(&activeCount).Error; err != nil {
		t.Fatalf("count active reservations: %v", err)
	}
	if activeCount != 1 {
		t.Fatalf("active reservations = %d, want 1", activeCount)
	}
}

func TestCancelReservationBackfillsLegacyLifecycleWithActingUser(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusReserved)
	if err := scenario.db.Model(&entity.RestaurantTable{}).Where("id = ?", table.ID).Updates(map[string]any{
		"reservation_name":  "Legacy guest",
		"reservation_phone": "0812345678",
	}).Error; err != nil {
		t.Fatalf("seed legacy reserved table: %v", err)
	}

	updated, err := scenario.tableSvc.CancelReservation(scenario.restaurant.ID, scenario.user.ID, table.ID)
	if err != nil {
		t.Fatalf("cancel legacy reservation: %v", err)
	}
	if updated.Status != entity.TableStatusFree {
		t.Fatalf("table status = %q, want free", updated.Status)
	}

	var reservation entity.Reservation
	if err := scenario.db.Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		First(&reservation).Error; err != nil {
		t.Fatalf("find backfilled reservation: %v", err)
	}
	if reservation.ReservedByUserID != scenario.user.ID {
		t.Fatalf("reserved_by_user_id = %d, want %d", reservation.ReservedByUserID, scenario.user.ID)
	}
	if reservation.Status != entity.ReservationStatusCancelled || reservation.ResolvedAt == nil {
		t.Fatalf("reservation = status %q resolved_at %v, want cancelled with timestamp", reservation.Status, reservation.ResolvedAt)
	}
}

func TestReservationSeatingSerializesConcurrentOrderOpen(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Arriving guest",
		2,
		nil,
	); err != nil {
		t.Fatalf("reserve table: %v", err)
	}

	start := make(chan struct{})
	errorsByAttempt := make([]error, 2)
	var wait sync.WaitGroup
	wait.Add(2)
	for attempt := range errorsByAttempt {
		go func(attempt int) {
			defer wait.Done()
			<-start
			tableID := table.ID
			_, errorsByAttempt[attempt] = scenario.orderSvc.OpenOrder(
				scenario.restaurant.ID,
				scenario.user.ID,
				&OpenOrderRequest{
					TableID:         &tableID,
					OrderType:       entity.OrderTypeDineIn,
					CustomerCount:   4,
					CustomerName:    "Arriving guest",
					CustomerPhone:   "0812345678",
					SeatReservation: true,
				},
			)
		}(attempt)
	}
	close(start)
	wait.Wait()

	successes := 0
	for _, err := range errorsByAttempt {
		if err == nil {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("successful concurrent arrivals = %d, want 1; errors = %v", successes, errorsByAttempt)
	}

	var activeOrders int64
	if err := scenario.db.Model(&entity.Order{}).
		Where(
			"restaurant_id = ? AND table_id = ? AND status NOT IN ?",
			scenario.restaurant.ID,
			table.ID,
			[]string{entity.OrderStatusCompleted, entity.OrderStatusCancelled},
		).
		Count(&activeOrders).Error; err != nil {
		t.Fatalf("count active orders: %v", err)
	}
	if activeOrders != 1 {
		t.Fatalf("active orders = %d, want 1", activeOrders)
	}

	var persistedTable entity.RestaurantTable
	if err := scenario.db.First(&persistedTable, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if persistedTable.Status != entity.TableStatusOccupied {
		t.Fatalf("table status = %q, want occupied", persistedTable.Status)
	}
	if persistedTable.ReservationName != "" || persistedTable.ReservationPhone != "" {
		t.Fatalf("reservation metadata was not cleared: %+v", persistedTable)
	}

	var reservation entity.Reservation
	if err := scenario.db.Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		First(&reservation).Error; err != nil {
		t.Fatalf("reload reservation: %v", err)
	}
	if reservation.Status != entity.ReservationStatusSeated || reservation.ResolvedAt == nil {
		t.Fatalf("reservation = status %q resolved_at %v, want seated with timestamp", reservation.Status, reservation.ResolvedAt)
	}
}

func TestReservationSeatingRollsBackOrderWhenLifecycleRecordIsMissing(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusReserved)
	if err := scenario.db.Model(&entity.RestaurantTable{}).Where("id = ?", table.ID).Updates(map[string]any{
		"reservation_name":  "Legacy guest",
		"reservation_phone": "0812345678",
	}).Error; err != nil {
		t.Fatalf("seed legacy reserved table: %v", err)
	}

	tableID := table.ID
	_, err := scenario.orderSvc.OpenOrder(
		scenario.restaurant.ID,
		scenario.user.ID,
		&OpenOrderRequest{
			TableID:         &tableID,
			OrderType:       entity.OrderTypeDineIn,
			CustomerCount:   2,
			SeatReservation: true,
		},
	)
	if err == nil || err.Error() != "table has no active reservation" {
		t.Fatalf("OpenOrder() error = %v, want missing reservation lifecycle error", err)
	}

	var orderCount int64
	if err := scenario.db.Model(&entity.Order{}).
		Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		Count(&orderCount).Error; err != nil {
		t.Fatalf("count rolled-back orders: %v", err)
	}
	if orderCount != 0 {
		t.Fatalf("orders after failed seating = %d, want 0", orderCount)
	}
	var persistedTable entity.RestaurantTable
	if err := scenario.db.First(&persistedTable, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if persistedTable.Status != entity.TableStatusReserved {
		t.Fatalf("table status after failed seating = %q, want reserved", persistedTable.Status)
	}
}

func TestCancelReservationReconcilesDuplicateActiveRows(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusReserved)
	scenario.duplicateActiveReservations(t, table, 3)

	updated, err := scenario.tableSvc.CancelReservation(scenario.restaurant.ID, scenario.user.ID, table.ID)
	if err != nil {
		t.Fatalf("cancel duplicate active reservations: %v", err)
	}
	if updated.Status != entity.TableStatusFree {
		t.Fatalf("table status = %q, want free", updated.Status)
	}

	var reservations []entity.Reservation
	if err := scenario.db.Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		Order("id asc").Find(&reservations).Error; err != nil {
		t.Fatalf("reload reconciled reservations: %v", err)
	}
	if len(reservations) != 3 {
		t.Fatalf("reservations = %d, want 3", len(reservations))
	}
	for _, reservation := range reservations {
		if reservation.Status != entity.ReservationStatusCancelled || reservation.ResolvedAt == nil {
			t.Fatalf("reservation %d = status %q resolved_at %v, want cancelled with timestamp", reservation.ID, reservation.Status, reservation.ResolvedAt)
		}
	}
}

func TestReservationSeatingReconcilesDuplicateActiveRows(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusReserved)
	seeded := scenario.duplicateActiveReservations(t, table, 3)
	canonicalID := seeded[len(seeded)-1].ID

	tableID := table.ID
	if _, err := scenario.orderSvc.OpenOrder(
		scenario.restaurant.ID,
		scenario.user.ID,
		&OpenOrderRequest{
			TableID:         &tableID,
			OrderType:       entity.OrderTypeDineIn,
			CustomerCount:   3,
			SeatReservation: true,
		},
	); err != nil {
		t.Fatalf("seat duplicate active reservations: %v", err)
	}

	var reservations []entity.Reservation
	if err := scenario.db.Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		Order("id asc").Find(&reservations).Error; err != nil {
		t.Fatalf("reload seated reservations: %v", err)
	}
	if len(reservations) != 3 {
		t.Fatalf("reservations = %d, want 3", len(reservations))
	}
	for _, reservation := range reservations {
		wantStatus := entity.ReservationStatusCancelled
		if reservation.ID == canonicalID {
			wantStatus = entity.ReservationStatusSeated
		}
		if reservation.Status != wantStatus || reservation.ResolvedAt == nil {
			t.Fatalf("reservation %d = status %q resolved_at %v, want %q with timestamp", reservation.ID, reservation.Status, reservation.ResolvedAt, wantStatus)
		}
	}
}

func TestLegacyTableStatusReconcilesDuplicateActiveRows(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 1, entity.TableStatusFree)
	seeded := scenario.duplicateActiveReservations(t, table, 3)
	canonicalID := seeded[len(seeded)-1].ID

	updated, err := scenario.tableSvc.UpdateTableStatus(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		entity.TableStatusReserved,
		"0899999999",
		"Canonical guest",
	)
	if err != nil {
		t.Fatalf("repair duplicate active reservations through legacy status: %v", err)
	}
	if updated.Status != entity.TableStatusReserved {
		t.Fatalf("table status = %q, want reserved", updated.Status)
	}

	var reservations []entity.Reservation
	if err := scenario.db.Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		Order("id asc").Find(&reservations).Error; err != nil {
		t.Fatalf("reload patched reservations: %v", err)
	}
	if len(reservations) != 3 {
		t.Fatalf("reservations = %d, want 3", len(reservations))
	}
	for _, reservation := range reservations {
		if reservation.ID == canonicalID {
			if reservation.Status != entity.ReservationStatusActive || reservation.ResolvedAt != nil {
				t.Fatalf("canonical reservation = status %q resolved_at %v, want active without timestamp", reservation.Status, reservation.ResolvedAt)
			}
			if reservation.Name != "Canonical guest" || reservation.Phone != "0899999999" {
				t.Fatalf("canonical details = %q/%q, want patched values", reservation.Name, reservation.Phone)
			}
			continue
		}
		if reservation.Status != entity.ReservationStatusCancelled || reservation.ResolvedAt == nil {
			t.Fatalf("superseded reservation %d = status %q resolved_at %v, want cancelled with timestamp", reservation.ID, reservation.Status, reservation.ResolvedAt)
		}
	}
}
