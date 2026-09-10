package service

import (
	"strings"
	"testing"

	"Project-M/internal/entity"
)

// The day's order number used to come from a COUNT of live orders. Closing a
// table that was opened but never ordered from soft-deletes its order, so that
// count drops below the highest number still in use and the next order is handed
// a number a live order already holds. The partial unique index rejects the
// insert, the transaction rolls back, the count stays wrong, and every later
// attempt collides the same way — on every table AND on takeaway — until the
// calendar date rolls over. Staff see "resource already exists" and cannot get
// past it. This is ordinary lunch service, not an edge case: a party sits down,
// changes its mind, and leaves before ordering.

func openDineIn(t *testing.T, scenario *reservationDBScenario, table entity.RestaurantTable) *entity.Order {
	t.Helper()
	tableID := table.ID
	order, err := scenario.orderSvc.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{
		TableID:       &tableID,
		OrderType:     entity.OrderTypeDineIn,
		CustomerCount: 2,
	})
	if err != nil {
		t.Fatalf("open dine-in on table %s: %v", table.TableNumber, err)
	}
	return order
}

func TestClosingAnEmptyTableDoesNotWedgeTheDaysOrderNumbers(t *testing.T) {
	scenario := newReservationDBScenario(t)
	first := scenario.table(t, 910, entity.TableStatusFree)
	second := scenario.table(t, 911, entity.TableStatusFree)
	third := scenario.table(t, 912, entity.TableStatusFree)

	orderOne := openDineIn(t, scenario, first)
	orderTwo := openDineIn(t, scenario, second)
	if orderOne.OrderNumber == orderTwo.OrderNumber {
		t.Fatalf("precondition: both orders got %q", orderOne.OrderNumber)
	}

	// The party leaves before ordering anything.
	if _, err := scenario.orderSvc.CloseEmptyTable(scenario.restaurant.ID, scenario.user.ID, orderOne.ID); err != nil {
		t.Fatalf("close empty table: %v", err)
	}

	orderThree, err := scenario.orderSvc.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{
		TableID:       &third.ID,
		OrderType:     entity.OrderTypeDineIn,
		CustomerCount: 2,
	})
	if err != nil {
		t.Fatalf("open a table after closing an empty one: %v", err)
	}
	if orderThree.OrderNumber == orderTwo.OrderNumber {
		t.Fatalf("order three reused the live number %q", orderTwo.OrderNumber)
	}

	// Takeaway shares the same per-day sequence, so it wedged too.
	takeaway, err := scenario.orderSvc.OpenOrder(scenario.restaurant.ID, scenario.user.ID, &OpenOrderRequest{
		OrderType:     entity.OrderTypeTakeaway,
		CustomerCount: 1,
	})
	if err != nil {
		t.Fatalf("open takeaway after closing an empty table: %v", err)
	}

	// The sequence only ever climbs: a number a customer may already have seen on
	// a printed slip must not come back on somebody else's order.
	seen := map[string]bool{}
	for _, order := range []*entity.Order{orderTwo, orderThree, takeaway} {
		if seen[order.OrderNumber] {
			t.Fatalf("order number %q was issued twice", order.OrderNumber)
		}
		seen[order.OrderNumber] = true
	}
	if !strings.HasPrefix(orderThree.OrderNumber, strings.Split(orderTwo.OrderNumber, "-")[0]) {
		t.Fatalf("order three %q is not on the same day as %q", orderThree.OrderNumber, orderTwo.OrderNumber)
	}
	if orderThree.OrderNumber <= orderTwo.OrderNumber || takeaway.OrderNumber <= orderThree.OrderNumber {
		t.Fatalf("numbers are not monotonic: %q then %q then %q", orderTwo.OrderNumber, orderThree.OrderNumber, takeaway.OrderNumber)
	}
}

// Sequences run per zone, but `table_number` is unique across the restaurant.
// Zone-less tables number `T<n>` and a zone whose prefix is "T" numbers `T%02d`,
// so both produce "T10" at sequence 10. The insert used to fail on the unique
// index and the owner was told the table already existed while looking at a
// screen that showed no such table — with no way past it, because the sequence
// never moved.
func TestZonePrefixCollidingWithZonelessLabelsStillCreates(t *testing.T) {
	scenario := newReservationDBScenario(t)

	// Ten zone-less tables: T1 .. T10.
	for sequence := 1; sequence <= 10; sequence++ {
		if _, err := scenario.tableSvc.CreateTable(scenario.restaurant.ID, &TableRequest{Capacity: 2}); err != nil {
			t.Fatalf("create zone-less table %d: %v", sequence, err)
		}
	}

	zone, err := scenario.tableSvc.CreateZone(scenario.restaurant.ID, &TableZoneRequest{Name: "Terrace", Prefix: "T"})
	if err != nil {
		t.Fatalf("create zone: %v", err)
	}

	// Ten more in that zone: T01 .. T09 are free, but sequence 10 wants "T10",
	// which the zone-less numbering already took.
	seen := map[string]bool{}
	for sequence := 1; sequence <= 10; sequence++ {
		table, err := scenario.tableSvc.CreateTable(scenario.restaurant.ID, &TableRequest{Capacity: 2, ZoneID: &zone.ID})
		if err != nil {
			t.Fatalf("create zoned table %d: %v", sequence, err)
		}
		if seen[table.TableNumber] {
			t.Fatalf("table number %q was issued twice", table.TableNumber)
		}
		seen[table.TableNumber] = true
	}
}
