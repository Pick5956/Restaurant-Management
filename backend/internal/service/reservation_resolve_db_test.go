package service

import (
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Resolving a booking by its own id is the only way a scheduled booking can ever
// be closed: every other reservation action is keyed by table, and a scheduled
// booking never takes its table's status, so table-keyed lookups cannot find it.

func TestResolveScheduledReservationLeavesTheTableAlone(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 601, entity.TableStatusFree)

	reservedFor := repository.BangkokNow().Add(2 * time.Hour)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Scheduled guest",
		4,
		&reservedFor,
	); err != nil {
		t.Fatalf("schedule reservation: %v", err)
	}

	var booking entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
		First(&booking).Error; err != nil {
		t.Fatalf("load scheduled reservation: %v", err)
	}

	resolved, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID,
		scenario.user.ID,
		booking.ID,
		entity.ReservationStatusCancelled,
	)
	if err != nil {
		t.Fatalf("resolve scheduled reservation: %v", err)
	}
	if resolved.Status != entity.ReservationStatusCancelled {
		t.Fatalf("status = %q, want cancelled", resolved.Status)
	}
	if resolved.ResolvedAt == nil {
		t.Fatal("resolved_at was not stamped")
	}

	var after entity.RestaurantTable
	if err := scenario.db.First(&after, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if after.Status != entity.TableStatusFree {
		t.Fatalf("table status = %q, want free - a scheduled booking must never move the table", after.Status)
	}
}

func TestResolveHoldFreesTheTableItWasHolding(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 602, entity.TableStatusFree)

	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Holding guest",
		2,
		nil,
	); err != nil {
		t.Fatalf("hold table: %v", err)
	}

	var held entity.RestaurantTable
	if err := scenario.db.First(&held, table.ID).Error; err != nil {
		t.Fatalf("reload held table: %v", err)
	}
	if held.Status != entity.TableStatusReserved {
		t.Fatalf("precondition: table status = %q, want reserved", held.Status)
	}

	var booking entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
		First(&booking).Error; err != nil {
		t.Fatalf("load hold: %v", err)
	}

	if _, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID,
		scenario.user.ID,
		booking.ID,
		entity.ReservationStatusCancelled,
	); err != nil {
		t.Fatalf("resolve hold: %v", err)
	}

	var after entity.RestaurantTable
	if err := scenario.db.First(&after, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if after.Status != entity.TableStatusFree {
		t.Fatalf("table status = %q, want free - resolving a hold releases the table it holds", after.Status)
	}
	if after.ReservationName != "" || after.ReservationPhone != "" {
		t.Fatalf("guest details left on the table: %q / %q", after.ReservationName, after.ReservationPhone)
	}
}

func TestResolveReservationRejectsRepeatAndBadOutcome(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 603, entity.TableStatusFree)

	reservedFor := repository.BangkokNow().Add(time.Hour)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID,
		scenario.user.ID,
		table.ID,
		"0812345678",
		"Repeat guest",
		2,
		&reservedFor,
	); err != nil {
		t.Fatalf("schedule reservation: %v", err)
	}
	var booking entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
		First(&booking).Error; err != nil {
		t.Fatalf("load reservation: %v", err)
	}

	if _, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID, scenario.user.ID, booking.ID, "deleted",
	); err == nil {
		t.Fatal("an outcome outside seated/cancelled was accepted")
	}

	if _, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID, scenario.user.ID, booking.ID, entity.ReservationStatusSeated,
	); err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	// Two staff tapping the same row must not both succeed.
	if _, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID, scenario.user.ID, booking.ID, entity.ReservationStatusCancelled,
	); err == nil {
		t.Fatal("an already-resolved reservation was resolved a second time")
	}
}

func TestResolveReservationIsScopedToItsRestaurant(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 604, entity.TableStatusFree)

	reservedFor := repository.BangkokNow().Add(time.Hour)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"0812345678", "Scoped guest", 2, &reservedFor,
	); err != nil {
		t.Fatalf("schedule reservation: %v", err)
	}
	var booking entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, table.ID).
		First(&booking).Error; err != nil {
		t.Fatalf("load reservation: %v", err)
	}

	if _, err := scenario.tableSvc.ResolveReservation(
		scenario.restaurant.ID+9999, scenario.user.ID, booking.ID, entity.ReservationStatusCancelled,
	); err == nil {
		t.Fatal("another restaurant resolved this booking")
	}
}

func TestStaleScheduledBookingsCloseThemselvesButHoldsDoNot(t *testing.T) {
	scenario := newReservationDBScenario(t)
	staleTable := scenario.table(t, 605, entity.TableStatusFree)
	heldTable := scenario.table(t, 606, entity.TableStatusFree)

	longPast := repository.BangkokNow().Add(-staleScheduledBookingAge - time.Hour)
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, staleTable.ID,
		"0812345678", "No-show guest", 2, &longPast,
	); err != nil {
		t.Fatalf("schedule stale booking: %v", err)
	}
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, heldTable.ID,
		"0812345678", "Holding guest", 2, nil,
	); err != nil {
		t.Fatalf("hold table: %v", err)
	}

	reservationSvc := ProvideReservationService(repository.NewReservationRepository(scenario.db))
	if _, err := reservationSvc.ListReservations(scenario.restaurant.ID, "", 50, 0); err != nil {
		t.Fatalf("list reservations: %v", err)
	}

	var stale entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, staleTable.ID).
		First(&stale).Error; err != nil {
		t.Fatalf("reload stale booking: %v", err)
	}
	if stale.Status != entity.ReservationStatusCancelled {
		t.Fatalf("stale scheduled booking status = %q, want cancelled", stale.Status)
	}

	// A hold has a table out of service. Releasing that is a floor decision, so
	// the sweep must never touch it however long it has been sitting there.
	var hold entity.Reservation
	if err := scenario.db.
		Where("restaurant_id = ? AND table_id = ?", scenario.restaurant.ID, heldTable.ID).
		First(&hold).Error; err != nil {
		t.Fatalf("reload hold: %v", err)
	}
	if hold.Status != entity.ReservationStatusActive {
		t.Fatalf("hold status = %q, want active - the sweep must leave holds alone", hold.Status)
	}
}
