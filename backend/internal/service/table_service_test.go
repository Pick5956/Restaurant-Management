package service

import (
	"strings"
	"testing"

	"Project-M/internal/entity"
)

func TestNormalizeCapacityBounds(t *testing.T) {
	if got, err := normalizeCapacity(0); err != nil || got != 2 {
		t.Fatalf("normalizeCapacity(0) = %d, %v; want 2, nil", got, err)
	}
	for _, value := range []int{-1, 51} {
		if _, err := normalizeCapacity(value); err == nil {
			t.Fatalf("normalizeCapacity(%d) should reject out-of-range value", value)
		}
	}
}

func TestReservationPhoneValidation(t *testing.T) {
	if !isValidReservationPhone("081-234-5678") {
		t.Fatal("valid Thai-style phone should be accepted")
	}
	if isValidReservationPhone("12345") {
		t.Fatal("short phone should be rejected")
	}
}

func TestValidateTableCanBeReservedRequiresFreeTable(t *testing.T) {
	if err := validateTableCanBeReserved(entity.TableStatusFree); err != nil {
		t.Fatalf("free table should be reservable: %v", err)
	}
	for _, status := range []string{
		entity.TableStatusOccupied,
		entity.TableStatusReserved,
		entity.TableStatusInactive,
	} {
		if err := validateTableCanBeReserved(status); err == nil || err.Error() != "table is not free" {
			t.Fatalf("status %q error = %v, want table is not free", status, err)
		}
	}
}

func TestValidateReservedTableReleaseRequiresReservedTableWithoutOpenOrder(t *testing.T) {
	if err := validateReservedTableRelease(entity.TableStatusReserved, false); err != nil {
		t.Fatalf("reserved table without an open order should be releasable: %v", err)
	}
	if err := validateReservedTableRelease(entity.TableStatusFree, false); err == nil || err.Error() != "table is not reserved" {
		t.Fatalf("free table error = %v, want table is not reserved", err)
	}
	if err := validateReservedTableRelease(entity.TableStatusReserved, true); err == nil || err.Error() != "table has an open order" {
		t.Fatalf("reserved table with open order error = %v, want table has an open order", err)
	}
}

func TestTableStatusForMetadataUpdatePreservesLifecycleManagedStatus(t *testing.T) {
	for _, current := range []string{
		entity.TableStatusReserved,
		entity.TableStatusOccupied,
	} {
		for _, requested := range []string{
			entity.TableStatusFree,
			entity.TableStatusInactive,
			entity.TableStatusReserved,
			entity.TableStatusOccupied,
		} {
			if got := tableStatusForMetadataUpdate(current, requested); got != current {
				t.Fatalf("tableStatusForMetadataUpdate(%q, %q) = %q, want current status %q", current, requested, got, current)
			}
		}
	}
}

func TestTableStatusForMetadataUpdateAllowsAvailabilityChanges(t *testing.T) {
	for _, testCase := range []struct {
		current   string
		requested string
	}{
		{current: entity.TableStatusFree, requested: entity.TableStatusInactive},
		{current: entity.TableStatusInactive, requested: entity.TableStatusFree},
	} {
		if got := tableStatusForMetadataUpdate(testCase.current, testCase.requested); got != testCase.requested {
			t.Fatalf(
				"tableStatusForMetadataUpdate(%q, %q) = %q, want requested status %q",
				testCase.current,
				testCase.requested,
				got,
				testCase.requested,
			)
		}
	}
}

func TestValidateMetadataTableStatusRejectsLifecycleTransitionsFromAvailability(t *testing.T) {
	for _, current := range []string{entity.TableStatusFree, entity.TableStatusInactive} {
		for _, requested := range []string{entity.TableStatusReserved, entity.TableStatusOccupied} {
			if err := validateMetadataTableStatus(current, requested); err == nil || err.Error() != "table status must be free or inactive" {
				t.Fatalf("validateMetadataTableStatus(%q, %q) error = %v, want availability-only error", current, requested, err)
			}
		}
	}
}

func TestValidateMetadataTableStatusAllowsAvailabilityAndPreservesLifecycle(t *testing.T) {
	for _, current := range []string{entity.TableStatusFree, entity.TableStatusInactive} {
		for _, requested := range []string{entity.TableStatusFree, entity.TableStatusInactive} {
			if err := validateMetadataTableStatus(current, requested); err != nil {
				t.Fatalf("availability transition %q -> %q rejected: %v", current, requested, err)
			}
		}
	}
	for _, current := range []string{entity.TableStatusReserved, entity.TableStatusOccupied} {
		for _, requested := range []string{
			entity.TableStatusFree,
			entity.TableStatusInactive,
			entity.TableStatusReserved,
			entity.TableStatusOccupied,
		} {
			if err := validateMetadataTableStatus(current, requested); err != nil {
				t.Fatalf("lifecycle metadata update %q with requested %q rejected: %v", current, requested, err)
			}
		}
	}
}

func TestApplyTableMetadataUpdateKeepsReservationWhileChangingCapacity(t *testing.T) {
	table := &entity.RestaurantTable{
		Capacity:         2,
		Status:           entity.TableStatusReserved,
		ReservationName:  "Guest",
		ReservationPhone: "0000000000",
	}
	requested := &entity.RestaurantTable{
		Capacity: 6,
		Status:   entity.TableStatusFree,
	}

	applyTableMetadataUpdate(table, requested)

	if table.Capacity != 6 {
		t.Fatalf("capacity = %d, want 6", table.Capacity)
	}
	if table.Status != entity.TableStatusReserved {
		t.Fatalf("status = %q, want reserved", table.Status)
	}
	if table.ReservationName != "Guest" || table.ReservationPhone != "0000000000" {
		t.Fatalf(
			"reservation metadata = %q/%q, want it preserved",
			table.ReservationName,
			table.ReservationPhone,
		)
	}
}

func TestTableInServiceIsAnOpenOrderOrAnOccupiedOrReservedTable(t *testing.T) {
	for _, testCase := range []struct {
		status       string
		hasOpenOrder bool
		want         bool
	}{
		{status: entity.TableStatusFree, hasOpenOrder: false, want: false},
		{status: entity.TableStatusInactive, hasOpenOrder: false, want: false},
		{status: entity.TableStatusOccupied, hasOpenOrder: false, want: true},
		{status: entity.TableStatusReserved, hasOpenOrder: false, want: true},
		// The order decides even when the status column has drifted from it.
		{status: entity.TableStatusFree, hasOpenOrder: true, want: true},
		{status: entity.TableStatusOccupied, hasOpenOrder: true, want: true},
		{status: entity.TableStatusReserved, hasOpenOrder: true, want: true},
		{status: entity.TableStatusInactive, hasOpenOrder: true, want: true},
	} {
		if got := tableInService(testCase.status, testCase.hasOpenOrder); got != testCase.want {
			t.Fatalf("tableInService(%q, %v) = %v, want %v", testCase.status, testCase.hasOpenOrder, got, testCase.want)
		}
	}
}

// Clients match this text to show their own wording for a locked table.
func TestTableInUseRefusalTextIsStable(t *testing.T) {
	if ErrTableInUse.Error() != "table is in use" {
		t.Fatalf("ErrTableInUse = %q, want %q", ErrTableInUse.Error(), "table is in use")
	}
}

func TestCustomerTableTokenIsStrongAndStrictlyValidated(t *testing.T) {
	token, err := GenerateCustomerTableToken()
	if err != nil {
		t.Fatalf("GenerateCustomerTableToken() error = %v", err)
	}
	if len(token) != customerTableTokenBytes*2 {
		t.Fatalf("token length = %d, want %d", len(token), customerTableTokenBytes*2)
	}
	if normalized, err := normalizeCustomerTableToken("  " + token + "  "); err != nil || normalized != token {
		t.Fatalf("normalizeCustomerTableToken() = %q, %v; want generated token", normalized, err)
	}
	for _, invalid := range []string{"", "short", strings.Repeat("z", customerTableTokenBytes*2)} {
		if _, err := normalizeCustomerTableToken(invalid); err == nil {
			t.Fatalf("normalizeCustomerTableToken(%q) accepted invalid token", invalid)
		}
	}
}
