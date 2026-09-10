package service

import (
	"strings"
	"testing"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// Two defects met here, and they pull in opposite directions, which is why both
// tests below have to exist at once.
//
// Scheduling used to insert unconditionally, so the same booking submitted twice
// became two active rows. Reconciling used to collapse *every* extra active row
// on a table, so a table's second booking of the evening was cancelled the
// moment anyone touched that table. Fixing either one alone would have made the
// other worse: the guard must reject a repeat of the same booking while leaving
// genuinely different bookings on the same table completely alone.

func activeBookingsFor(t *testing.T, scenario *reservationDBScenario, tableID uint) []entity.Reservation {
	t.Helper()
	var bookings []entity.Reservation
	if err := scenario.db.
		Where(
			"restaurant_id = ? AND table_id = ? AND status = ?",
			scenario.restaurant.ID,
			tableID,
			entity.ReservationStatusActive,
		).
		Order("id asc").
		Find(&bookings).Error; err != nil {
		t.Fatalf("load active bookings: %v", err)
	}
	return bookings
}

func TestSchedulingTheSameBookingTwiceKeepsOneRow(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 651, entity.TableStatusFree)
	reservedFor := repository.BangkokNow().Add(3 * time.Hour).Truncate(time.Minute)

	for attempt := 1; attempt <= 3; attempt++ {
		if _, err := scenario.tableSvc.ReserveTable(
			scenario.restaurant.ID,
			scenario.user.ID,
			table.ID,
			"0812345678",
			"Repeat guest",
			2,
			&reservedFor,
		); err != nil {
			t.Fatalf("schedule attempt %d: %v", attempt, err)
		}
	}

	bookings := activeBookingsFor(t, scenario, table.ID)
	if len(bookings) != 1 {
		t.Fatalf("active bookings = %d, want 1 - the same booking submitted three times is still one booking", len(bookings))
	}
	if bookings[0].GuestCount != 2 {
		t.Fatalf("guest count = %d, want 2", bookings[0].GuestCount)
	}
}

func TestSchedulingTheSameSlotForADifferentGuestIsRejected(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 652, entity.TableStatusFree)
	reservedFor := repository.BangkokNow().Add(3 * time.Hour).Truncate(time.Minute)

	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"0812345678", "First party", 2, &reservedFor,
	); err != nil {
		t.Fatalf("first booking: %v", err)
	}

	_, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"0899999999", "Second party", 4, &reservedFor,
	)
	if err == nil {
		t.Fatal("a second party was allowed to book a table already booked for that instant")
	}
	if !strings.Contains(err.Error(), "already booked") {
		t.Fatalf("error = %q, want it to say the slot is taken", err)
	}

	if bookings := activeBookingsFor(t, scenario, table.ID); len(bookings) != 1 {
		t.Fatalf("active bookings = %d, want 1", len(bookings))
	}
}

func TestSamePhoneWrittenWithSeparatorsIsStillTheSameGuest(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 653, entity.TableStatusFree)
	reservedFor := repository.BangkokNow().Add(4 * time.Hour).Truncate(time.Minute)

	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"0812345678", "Guest", 2, &reservedFor,
	); err != nil {
		t.Fatalf("first booking: %v", err)
	}
	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"081-234-5678", "Guest", 2, &reservedFor,
	); err != nil {
		t.Fatalf("resubmit with separators: %v", err)
	}

	if bookings := activeBookingsFor(t, scenario, table.ID); len(bookings) != 1 {
		t.Fatalf("active bookings = %d, want 1 - separators do not make a second guest", len(bookings))
	}
}

func TestSubMinuteDriftLandsInTheSameSlot(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 654, entity.TableStatusFree)
	base := repository.BangkokNow().Add(5 * time.Hour).Truncate(time.Minute)
	drifted := base.Add(37 * time.Second)

	for _, instant := range []time.Time{base, drifted} {
		when := instant
		if _, err := scenario.tableSvc.ReserveTable(
			scenario.restaurant.ID, scenario.user.ID, table.ID,
			"0812345678", "Guest", 2, &when,
		); err != nil {
			t.Fatalf("schedule at %s: %v", when, err)
		}
	}

	bookings := activeBookingsFor(t, scenario, table.ID)
	if len(bookings) != 1 {
		t.Fatalf("active bookings = %d, want 1 - a stray 37 seconds is not a different booking", len(bookings))
	}
	if bookings[0].ReservedFor == nil || !bookings[0].ReservedFor.Equal(base) {
		t.Fatalf("reserved_for = %v, want it truncated to %v", bookings[0].ReservedFor, base)
	}
}

func TestOneTableStillTakesSeveralBookingsAcrossAnEvening(t *testing.T) {
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 655, entity.TableStatusFree)
	early := repository.BangkokNow().Add(2 * time.Hour).Truncate(time.Minute)
	late := repository.BangkokNow().Add(5 * time.Hour).Truncate(time.Minute)

	for _, slot := range []time.Time{early, late} {
		when := slot
		if _, err := scenario.tableSvc.ReserveTable(
			scenario.restaurant.ID, scenario.user.ID, table.ID,
			"0812345678", "Same guest, two sittings", 2, &when,
		); err != nil {
			t.Fatalf("schedule at %s: %v", when, err)
		}
	}

	if bookings := activeBookingsFor(t, scenario, table.ID); len(bookings) != 2 {
		t.Fatalf("active bookings = %d, want 2 - the duplicate guard must not collapse different times", len(bookings))
	}
}

func TestHoldingATableLeavesItsScheduledBookingsAlone(t *testing.T) {
	// The reconcile path used to select every active row for the table with no
	// `reserved_for` filter, keep the newest and cancel the rest. Holding a table
	// with two bookings on it therefore cancelled one of them and rewrote the
	// other into the hold - so a booking could disappear between being taken and
	// the guests arriving, and the floor would never know.
	scenario := newReservationDBScenario(t)
	table := scenario.table(t, 656, entity.TableStatusFree)
	early := repository.BangkokNow().Add(2 * time.Hour).Truncate(time.Minute)
	late := repository.BangkokNow().Add(5 * time.Hour).Truncate(time.Minute)

	for _, slot := range []time.Time{early, late} {
		when := slot
		if _, err := scenario.tableSvc.ReserveTable(
			scenario.restaurant.ID, scenario.user.ID, table.ID,
			"0812345678", "Evening booking", 2, &when,
		); err != nil {
			t.Fatalf("schedule at %s: %v", when, err)
		}
	}

	if _, err := scenario.tableSvc.ReserveTable(
		scenario.restaurant.ID, scenario.user.ID, table.ID,
		"0898888888", "Walk-up", 2, nil,
	); err != nil {
		t.Fatalf("hold the table: %v", err)
	}

	bookings := activeBookingsFor(t, scenario, table.ID)
	scheduled := 0
	holds := 0
	for _, booking := range bookings {
		if booking.ReservedFor == nil {
			holds++
			continue
		}
		scheduled++
	}
	if scheduled != 2 {
		t.Fatalf("scheduled bookings surviving the hold = %d, want 2", scheduled)
	}
	if holds != 1 {
		t.Fatalf("holds = %d, want 1 - the hold must be its own row, not a rewritten booking", holds)
	}

	var held entity.RestaurantTable
	if err := scenario.db.First(&held, table.ID).Error; err != nil {
		t.Fatalf("reload table: %v", err)
	}
	if held.Status != entity.TableStatusReserved {
		t.Fatalf("table status = %q, want reserved", held.Status)
	}
}

func TestTheDuplicateGuardIsScopedToOneRestaurant(t *testing.T) {
	first := newReservationDBScenario(t)
	second := newReservationDBScenario(t)
	firstTable := first.table(t, 657, entity.TableStatusFree)
	secondTable := second.table(t, 657, entity.TableStatusFree)
	reservedFor := repository.BangkokNow().Add(3 * time.Hour).Truncate(time.Minute)

	if _, err := first.tableSvc.ReserveTable(
		first.restaurant.ID, first.user.ID, firstTable.ID,
		"0812345678", "Guest", 2, &reservedFor,
	); err != nil {
		t.Fatalf("first restaurant booking: %v", err)
	}
	if _, err := second.tableSvc.ReserveTable(
		second.restaurant.ID, second.user.ID, secondTable.ID,
		"0812345678", "Guest", 2, &reservedFor,
	); err != nil {
		t.Fatalf("second restaurant booking rejected by another tenant's row: %v", err)
	}

	if bookings := activeBookingsFor(t, second, secondTable.ID); len(bookings) != 1 {
		t.Fatalf("second restaurant active bookings = %d, want 1", len(bookings))
	}
}

// ResolveReservation used to lock the reservation row and then the table row,
// while every other path that holds both locks the table first. That is an ABBA
// inversion on the same two rows, and it is not theoretical: cancelling a hold
// from the history list while someone seats the same table is one real event
// reached from two screens. Measured at 205 deadlocks in 300 overlapping
// attempts before the order was corrected.
func TestResolvingAHoldDoesNotDeadlockAgainstTheTablePath(t *testing.T) {
	scenario := newReservationDBScenario(t)
	const rounds = 30
	deadlocks := 0

	for round := 0; round < rounds; round++ {
		table := scenario.table(t, 700+round, entity.TableStatusFree)
		if _, err := scenario.tableSvc.ReserveTable(
			scenario.restaurant.ID, scenario.user.ID, table.ID,
			"0812345678", "Holding guest", 2, nil,
		); err != nil {
			t.Fatalf("round %d: hold table: %v", round, err)
		}
		var booking entity.Reservation
		if err := scenario.db.
			Where("restaurant_id = ? AND table_id = ? AND status = ?", scenario.restaurant.ID, table.ID, entity.ReservationStatusActive).
			First(&booking).Error; err != nil {
			t.Fatalf("round %d: load hold: %v", round, err)
		}

		errs := make(chan error, 2)
		start := make(chan struct{})
		go func() {
			<-start
			_, err := scenario.tableSvc.CancelReservation(scenario.restaurant.ID, scenario.user.ID, table.ID)
			errs <- err
		}()
		go func() {
			<-start
			_, err := scenario.tableSvc.ResolveReservation(
				scenario.restaurant.ID, scenario.user.ID, booking.ID, entity.ReservationStatusSeated,
			)
			errs <- err
		}()
		close(start)
		for i := 0; i < 2; i++ {
			// One of the two losing on business grounds is correct and expected:
			// whichever runs second finds the booking already resolved. A
			// deadlock is not - it is the database giving up on a lock cycle.
			if err := <-errs; err != nil && strings.Contains(strings.ToLower(err.Error()), "deadlock") {
				deadlocks++
			}
		}
	}

	if deadlocks > 0 {
		t.Fatalf("%d deadlocks across %d rounds; ResolveReservation must lock the table before the reservation", deadlocks, rounds)
	}
}
