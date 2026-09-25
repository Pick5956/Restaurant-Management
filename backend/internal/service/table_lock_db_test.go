package service

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// These run against PostgreSQL like the rest of table_service_db_test.go, and
// skip unless RESERVATION_DB_TEST_ENABLED=1.
//
// The rule under test (owner, 2026-09-23): table management is only for adding,
// editing and removing tables, so a table still in service takes no edit of any
// kind until it is closed through the service steps. See tableInService.

// tableState puts one fresh table into a state and returns its id.
type tableState struct {
	name  string
	setup func(t *testing.T, scenario *reservationDBScenario, sequence int) uint
	// deleteRefusal is what DeleteTable still says for a table out of service,
	// or "" when the table can simply be deleted.
	deleteRefusal string
}

// tableEdit is one table-management mutation, through the same service method
// its endpoint calls.
type tableEdit struct {
	name string
	run  func(t *testing.T, scenario *reservationDBScenario, tableID uint) error
	// landed checks the edit took effect on a table out of service.
	landed func(t *testing.T, before, after entity.RestaurantTable)
}

const heldGuestPhone = "0812345678"

func (scenario *reservationDBScenario) openTableOrder(t *testing.T, tableID uint) entity.Order {
	t.Helper()
	id := tableID
	order, err := scenario.orderSvc.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{
		TableID:       &id,
		OrderType:     entity.OrderTypeDineIn,
		CustomerCount: 2,
	})
	if err != nil {
		t.Fatalf("open order on table %d: %v", tableID, err)
	}
	return *order
}

func (scenario *reservationDBScenario) holdTable(t *testing.T, tableID uint) {
	t.Helper()
	if _, err := scenario.tableSvc.ReserveTable(scenario.restaurant.ID, scenario.user.ID, tableID, heldGuestPhone, "Held guest", 2, nil); err != nil {
		t.Fatalf("hold table %d: %v", tableID, err)
	}
}

func (scenario *reservationDBScenario) bookTableForLater(t *testing.T, tableID uint) {
	t.Helper()
	later := repository.BangkokNow().Add(3 * time.Hour)
	if _, err := scenario.tableSvc.ReserveTable(scenario.restaurant.ID, scenario.user.ID, tableID, heldGuestPhone, "Later guest", 2, &later); err != nil {
		t.Fatalf("book table %d for later: %v", tableID, err)
	}
}

// payTable seats a party, gives it one dish the kitchen has finished, and pays
// the bill in cash - the whole service loop, through the order service.
func (scenario *reservationDBScenario) payTable(t *testing.T, tableID uint) {
	t.Helper()
	order := scenario.openTableOrder(t, tableID)
	// One category per table: names are unique within a restaurant.
	category := entity.Category{RestaurantID: scenario.restaurant.ID, Name: fmt.Sprintf("Lock tests %d", tableID), IsActive: true}
	if err := scenario.db.Create(&category).Error; err != nil {
		t.Fatalf("create category: %v", err)
	}
	menu := entity.MenuItem{RestaurantID: scenario.restaurant.ID, CategoryID: category.ID, Name: "Lock dish", Price: 100, IsAvailable: true}
	if err := scenario.db.Create(&menu).Error; err != nil {
		t.Fatalf("create menu item: %v", err)
	}
	now := repository.BangkokNow()
	item := entity.OrderItem{
		OrderID:         order.ID,
		RestaurantID:    scenario.restaurant.ID,
		MenuID:          menu.ID,
		MenuName:        menu.Name,
		UnitPrice:       menu.Price,
		Quantity:        1,
		Subtotal:        menu.Price,
		FulfillmentType: entity.OrderTypeDineIn,
		Status:          entity.OrderItemStatusReady,
		SentAt:          &now,
		KitchenBatch:    1,
	}
	if err := scenario.db.Create(&item).Error; err != nil {
		t.Fatalf("create ready order item: %v", err)
	}
	if _, err := scenario.orderSvc.PayOrder(scenario.restaurant.ID, scenario.user.ID, order.ID, &PayOrderRequest{Method: "cash", ReceivedAmount: 1000}); err != nil {
		t.Fatalf("pay order on table %d: %v", tableID, err)
	}
}

func (scenario *reservationDBScenario) reloadTable(t *testing.T, tableID uint) entity.RestaurantTable {
	t.Helper()
	var table entity.RestaurantTable
	if err := scenario.db.Unscoped().First(&table, tableID).Error; err != nil {
		t.Fatalf("reload table %d: %v", tableID, err)
	}
	return table
}

func (scenario *reservationDBScenario) zone(t *testing.T, name, prefix string) entity.TableZone {
	t.Helper()
	zone, err := scenario.tableSvc.CreateZone(scenario.restaurant.ID, &TableZoneRequest{Name: name, Prefix: prefix})
	if err != nil {
		t.Fatalf("create zone %s: %v", name, err)
	}
	return *zone
}

func (scenario *reservationDBScenario) tableInZone(t *testing.T, zoneID uint, status string) entity.RestaurantTable {
	t.Helper()
	id := zoneID
	table, err := scenario.tableSvc.CreateTable(scenario.restaurant.ID, &TableRequest{ZoneID: &id, Capacity: 4, Status: status})
	if err != nil {
		t.Fatalf("create table in zone %d: %v", zoneID, err)
	}
	return *table
}

func tableStatesInService() []tableState {
	return []tableState{
		{name: "seated with an open order", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			table := scenario.table(t, sequence, entity.TableStatusFree)
			scenario.openTableOrder(t, table.ID)
			return table.ID
		}},
		{name: "held for a booking now", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			table := scenario.table(t, sequence, entity.TableStatusFree)
			scenario.holdTable(t, table.ID)
			return table.ID
		}},
		{name: "marked occupied without an order", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			return scenario.table(t, sequence, entity.TableStatusOccupied).ID
		}},
		{name: "marked reserved without a booking row", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			return scenario.table(t, sequence, entity.TableStatusReserved).ID
		}},
		// The status column has drifted to free, but the order is still open:
		// the order decides.
		{name: "open order under a free status", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			table := scenario.table(t, sequence, entity.TableStatusFree)
			scenario.openTableOrder(t, table.ID)
			if err := scenario.db.Model(&entity.RestaurantTable{}).Where("id = ?", table.ID).Update("status", entity.TableStatusFree).Error; err != nil {
				t.Fatalf("drift table status to free: %v", err)
			}
			return table.ID
		}},
	}
}

func tableStatesOutOfService() []tableState {
	const orderHistory = "table has order history; mark it inactive instead"
	return []tableState{
		{name: "free", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			return scenario.table(t, sequence, entity.TableStatusFree).ID
		}},
		{name: "inactive", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			return scenario.table(t, sequence, entity.TableStatusInactive).ID
		}},
		{
			name: "free with a booking for later",
			setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
				table := scenario.table(t, sequence, entity.TableStatusFree)
				scenario.bookTableForLater(t, table.ID)
				return table.ID
			},
			deleteRefusal: "table has an active reservation; cancel it first",
		},
		{
			name: "free again after its bill was paid",
			setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
				table := scenario.table(t, sequence, entity.TableStatusFree)
				scenario.payTable(t, table.ID)
				return table.ID
			},
			deleteRefusal: orderHistory,
		},
		{
			name: "free again after its empty order was closed",
			setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
				table := scenario.table(t, sequence, entity.TableStatusFree)
				order := scenario.openTableOrder(t, table.ID)
				if _, err := scenario.orderSvc.CloseEmptyTable(scenario.restaurant.ID, scenario.user.ID, order.ID); err != nil {
					t.Fatalf("close empty table: %v", err)
				}
				return table.ID
			},
			deleteRefusal: orderHistory,
		},
		{name: "free again after its booking was cancelled", setup: func(t *testing.T, scenario *reservationDBScenario, sequence int) uint {
			table := scenario.table(t, sequence, entity.TableStatusFree)
			scenario.holdTable(t, table.ID)
			if _, err := scenario.tableSvc.CancelReservation(scenario.restaurant.ID, scenario.user.ID, table.ID); err != nil {
				t.Fatalf("cancel booking: %v", err)
			}
			return table.ID
		}},
	}
}

// flippedAvailability is the open/closed switch: closed opens, anything else
// closes.
func flippedAvailability(status string) string {
	if status == entity.TableStatusInactive {
		return entity.TableStatusFree
	}
	return entity.TableStatusInactive
}

func tableManagementEdits(zoneID uint) []tableEdit {
	return []tableEdit{
		{
			name: "seats and open/closed switch",
			run: func(t *testing.T, scenario *reservationDBScenario, tableID uint) error {
				current := scenario.reloadTable(t, tableID)
				_, err := scenario.tableSvc.UpdateTable(scenario.restaurant.ID, tableID, &TableRequest{
					Capacity: 7,
					Status:   flippedAvailability(current.Status),
				})
				return err
			},
			landed: func(t *testing.T, before, after entity.RestaurantTable) {
				if after.Capacity != 7 || after.Status != flippedAvailability(before.Status) {
					t.Fatalf("table = capacity %d status %q, want 7/%q", after.Capacity, after.Status, flippedAvailability(before.Status))
				}
			},
		},
		{
			name: "zone move",
			run: func(t *testing.T, scenario *reservationDBScenario, tableID uint) error {
				id := zoneID
				_, err := scenario.tableSvc.MoveTableZone(scenario.restaurant.ID, tableID, &MoveTableZoneRequest{ZoneID: &id})
				return err
			},
			landed: func(t *testing.T, before, after entity.RestaurantTable) {
				if after.ZoneID == nil || *after.ZoneID != zoneID || after.TableNumber == before.TableNumber {
					t.Fatalf("moved table = zone %v label %q, want zone %d and a new label", after.ZoneID, after.TableNumber, zoneID)
				}
			},
		},
		{
			// The open/closed switch reached through the status endpoint
			// instead of PUT /tables/:id.
			name: "switch off on the status endpoint",
			run: func(t *testing.T, scenario *reservationDBScenario, tableID uint) error {
				_, err := scenario.tableSvc.UpdateTableStatus(scenario.restaurant.ID, scenario.user.ID, tableID, entity.TableStatusInactive, "", "")
				return err
			},
			landed: func(t *testing.T, before, after entity.RestaurantTable) {
				if after.Status != entity.TableStatusInactive {
					t.Fatalf("table status = %q, want %q", after.Status, entity.TableStatusInactive)
				}
			},
		},
		{
			name: "new QR",
			run: func(t *testing.T, scenario *reservationDBScenario, tableID uint) error {
				_, err := scenario.tableSvc.RegenerateCustomerToken(scenario.restaurant.ID, tableID)
				return err
			},
			landed: func(t *testing.T, before, after entity.RestaurantTable) {
				if after.CustomerToken == before.CustomerToken || after.CustomerToken == "" {
					t.Fatal("customer token did not change")
				}
			},
		},
		{
			name: "delete",
			run: func(t *testing.T, scenario *reservationDBScenario, tableID uint) error {
				return scenario.tableSvc.DeleteTable(scenario.restaurant.ID, tableID)
			},
			landed: func(t *testing.T, before, after entity.RestaurantTable) {
				if !after.DeletedAt.Valid {
					t.Fatal("table was not deleted")
				}
			},
		},
	}
}

func sameZoneID(left, right *uint) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func assertTableUntouched(t *testing.T, before, after entity.RestaurantTable) {
	t.Helper()
	if before.Status != after.Status ||
		before.Capacity != after.Capacity ||
		!sameZoneID(before.ZoneID, after.ZoneID) ||
		before.Zone != after.Zone ||
		before.TableNumber != after.TableNumber ||
		before.DisplayLabel != after.DisplayLabel ||
		before.SequenceNumber != after.SequenceNumber ||
		before.CustomerToken != after.CustomerToken ||
		before.ReservationName != after.ReservationName ||
		before.ReservationPhone != after.ReservationPhone ||
		before.DeletedAt.Valid != after.DeletedAt.Valid {
		t.Fatalf("refused edit still changed the table:\nbefore %+v\nafter  %+v", before, after)
	}
}

func TestTableManagementRefusesEveryEditToATableInService(t *testing.T) {
	scenario := newReservationDBScenario(t)
	zone := scenario.zone(t, "Garden", "G")
	sequence := 0
	for _, state := range tableStatesInService() {
		for _, edit := range tableManagementEdits(zone.ID) {
			sequence++
			sequence := sequence
			t.Run(state.name+"/"+edit.name, func(t *testing.T) {
				tableID := state.setup(t, scenario, sequence)
				before := scenario.reloadTable(t, tableID)
				err := edit.run(t, scenario, tableID)
				if !errors.Is(err, ErrTableInUse) {
					t.Fatalf("error = %v, want %v", err, ErrTableInUse)
				}
				if err.Error() != "table is in use" {
					t.Fatalf("error text = %q, want the stable %q", err.Error(), "table is in use")
				}
				assertTableUntouched(t, before, scenario.reloadTable(t, tableID))
			})
		}
	}
}

func TestTableManagementStillEditsTablesOutOfService(t *testing.T) {
	scenario := newReservationDBScenario(t)
	zone := scenario.zone(t, "Garden", "G")
	sequence := 0
	for _, state := range tableStatesOutOfService() {
		for _, edit := range tableManagementEdits(zone.ID) {
			sequence++
			sequence := sequence
			t.Run(state.name+"/"+edit.name, func(t *testing.T) {
				tableID := state.setup(t, scenario, sequence)
				before := scenario.reloadTable(t, tableID)
				err := edit.run(t, scenario, tableID)
				if errors.Is(err, ErrTableInUse) {
					t.Fatalf("a table out of service was refused as in use")
				}
				if edit.name == "delete" && state.deleteRefusal != "" {
					if err == nil || err.Error() != state.deleteRefusal {
						t.Fatalf("delete error = %v, want %q", err, state.deleteRefusal)
					}
					assertTableUntouched(t, before, scenario.reloadTable(t, tableID))
					return
				}
				if err != nil {
					t.Fatalf("edit refused: %v", err)
				}
				edit.landed(t, before, scenario.reloadTable(t, tableID))
			})
		}
	}
}

// A new prefix relabels every table in the zone, so one table in service blocks
// it. A rename or a new display order relabels nothing and stays open.
func TestZoneRelabelWaitsForEveryTableInTheZoneToLeaveService(t *testing.T) {
	scenario := newReservationDBScenario(t)
	zone := scenario.zone(t, "Patio", "P")
	seated := scenario.tableInZone(t, zone.ID, entity.TableStatusFree)
	held := scenario.tableInZone(t, zone.ID, entity.TableStatusFree)
	closed := scenario.tableInZone(t, zone.ID, entity.TableStatusInactive)
	order := scenario.openTableOrder(t, seated.ID)
	scenario.holdTable(t, held.ID)

	labels := func() []string {
		return []string{
			scenario.reloadTable(t, seated.ID).TableNumber,
			scenario.reloadTable(t, held.ID).TableNumber,
			scenario.reloadTable(t, closed.ID).TableNumber,
		}
	}
	assertLabels := func(want ...string) {
		t.Helper()
		got := labels()
		for index := range want {
			if got[index] != want[index] {
				t.Fatalf("labels = %v, want %v", got, want)
			}
		}
	}
	assertLabels("P01", "P02", "P03")

	relabel := func(name, prefix string, displayOrder int) (*entity.TableZone, error) {
		return scenario.tableSvc.UpdateZone(scenario.restaurant.ID, zone.ID, &TableZoneRequest{Name: name, Prefix: prefix, DisplayOrder: displayOrder})
	}

	if _, err := relabel("Patio", "Q", 0); !errors.Is(err, ErrTableInUse) {
		t.Fatalf("relabel with a seated and a held table error = %v, want %v", err, ErrTableInUse)
	}
	var persistedZone entity.TableZone
	if err := scenario.db.First(&persistedZone, zone.ID).Error; err != nil {
		t.Fatalf("reload zone: %v", err)
	}
	if persistedZone.Prefix != "P" {
		t.Fatalf("refused relabel still changed the prefix to %q", persistedZone.Prefix)
	}
	assertLabels("P01", "P02", "P03")

	// A rename and a reorder do not relabel, and the busy tables stay busy.
	if _, err := relabel("Terrace", "P", 3); err != nil {
		t.Fatalf("rename zone while tables are in service: %v", err)
	}
	if got := scenario.reloadTable(t, seated.ID); got.Zone != "Terrace" || got.Status != entity.TableStatusOccupied {
		t.Fatalf("seated table after rename = zone %q status %q, want Terrace/occupied", got.Zone, got.Status)
	}
	if got := scenario.reloadTable(t, held.ID); got.Status != entity.TableStatusReserved || got.ReservationPhone != heldGuestPhone {
		t.Fatalf("held table after rename = status %q phone %q, want reserved with its booking", got.Status, got.ReservationPhone)
	}
	assertLabels("P01", "P02", "P03")

	// Closing the order through the service steps is not enough while the held
	// table is still held.
	if _, err := scenario.orderSvc.CloseEmptyTable(scenario.restaurant.ID, scenario.user.ID, order.ID); err != nil {
		t.Fatalf("close empty table: %v", err)
	}
	if _, err := relabel("Terrace", "Q", 3); !errors.Is(err, ErrTableInUse) {
		t.Fatalf("relabel with a held table error = %v, want %v", err, ErrTableInUse)
	}

	if _, err := scenario.tableSvc.CancelReservation(scenario.restaurant.ID, scenario.user.ID, held.ID); err != nil {
		t.Fatalf("cancel booking: %v", err)
	}
	if _, err := relabel("Terrace", "Q", 3); err != nil {
		t.Fatalf("relabel once every table left service: %v", err)
	}
	assertLabels("Q01", "Q02", "Q03")
}

// The guard sits on the management edits only. Seating, holding, freeing,
// paying and closing are how a table gets into and out of service, and every
// one of them has to keep working on the very tables the guard refuses.
func TestServiceStepsStillMoveTablesInAndOutOfService(t *testing.T) {
	scenario := newReservationDBScenario(t)
	seatSeats := func(tableID uint) error {
		_, err := scenario.tableSvc.UpdateTable(scenario.restaurant.ID, tableID, &TableRequest{Capacity: 6, Status: entity.TableStatusFree})
		return err
	}

	// The POS status switch: free -> reserved -> free.
	posTable := scenario.table(t, 1, entity.TableStatusFree)
	if _, err := scenario.tableSvc.UpdateTableStatus(scenario.restaurant.ID, scenario.user.ID, posTable.ID, entity.TableStatusReserved, heldGuestPhone, "Walk-up"); err != nil {
		t.Fatalf("POS reserve: %v", err)
	}
	if err := seatSeats(posTable.ID); !errors.Is(err, ErrTableInUse) {
		t.Fatalf("edit of a POS-reserved table error = %v, want %v", err, ErrTableInUse)
	}
	if _, err := scenario.tableSvc.UpdateTableStatus(scenario.restaurant.ID, scenario.user.ID, posTable.ID, entity.TableStatusFree, "", ""); err != nil {
		t.Fatalf("POS free: %v", err)
	}
	if err := seatSeats(posTable.ID); err != nil {
		t.Fatalf("edit after POS freed the table: %v", err)
	}

	// A held booking is seated by opening an order, then paid.
	heldTable := scenario.table(t, 2, entity.TableStatusFree)
	scenario.holdTable(t, heldTable.ID)
	heldTableID := heldTable.ID
	seated, err := scenario.orderSvc.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{
		TableID:         &heldTableID,
		OrderType:       entity.OrderTypeDineIn,
		CustomerCount:   2,
		SeatReservation: true,
	})
	if err != nil {
		t.Fatalf("seat held booking: %v", err)
	}
	if got := scenario.reloadTable(t, heldTable.ID); got.Status != entity.TableStatusOccupied {
		t.Fatalf("seated table status = %q, want occupied", got.Status)
	}
	if err := seatSeats(heldTable.ID); !errors.Is(err, ErrTableInUse) {
		t.Fatalf("edit of a seated table error = %v, want %v", err, ErrTableInUse)
	}
	if _, err := scenario.orderSvc.CancelOrder(scenario.restaurant.ID, scenario.user.ID, seated.ID, "guests left", true); err != nil {
		t.Fatalf("cancel seated order: %v", err)
	}
	if got := scenario.reloadTable(t, heldTable.ID); got.Status != entity.TableStatusFree {
		t.Fatalf("table status after the order was cancelled = %q, want free", got.Status)
	}
	if err := seatSeats(heldTable.ID); err != nil {
		t.Fatalf("edit after the order was cancelled: %v", err)
	}

	// Payment frees the table and the table is editable again.
	paidTable := scenario.table(t, 3, entity.TableStatusFree)
	scenario.payTable(t, paidTable.ID)
	if got := scenario.reloadTable(t, paidTable.ID); got.Status != entity.TableStatusFree {
		t.Fatalf("table status after payment = %q, want free", got.Status)
	}
	if err := seatSeats(paidTable.ID); err != nil {
		t.Fatalf("edit after payment: %v", err)
	}
}
