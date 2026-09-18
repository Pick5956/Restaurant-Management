package service

import (
	"testing"
	"time"
)

func TestManagerReportSinceCoversWholeCalendarDays(t *testing.T) {
	bangkok := time.FixedZone("Asia/Bangkok", 7*60*60)
	now := time.Date(2026, 9, 15, 15, 11, 0, 0, bangkok)

	got := managerReportSince(now, 14)
	want := time.Date(2026, 9, 2, 0, 0, 0, 0, bangkok)
	if !got.Equal(want) {
		t.Fatalf("14 days ending 15 Sep should start at %v, got %v", want, got)
	}
	if got := managerReportSince(now, 1); !got.Equal(time.Date(2026, 9, 15, 0, 0, 0, 0, bangkok)) {
		t.Fatalf("a one-day report is today from midnight, got %v", got)
	}
	// Crossing a month boundary.
	if got := managerReportSince(time.Date(2026, 10, 3, 9, 0, 0, 0, bangkok), 7); !got.Equal(time.Date(2026, 9, 27, 0, 0, 0, 0, bangkok)) {
		t.Fatalf("7 days ending 3 Oct should start 27 Sep, got %v", got)
	}
}

func TestParseManagerReportRange(t *testing.T) {
	bangkok := time.FixedZone("Asia/Bangkok", 7*60*60)
	now := time.Date(2026, 9, 15, 15, 11, 0, 0, bangkok)

	start, end, err := ParseManagerReportRange("2026-09-05", "2026-09-05", now)
	if err != nil || !start.Equal(end) || start.Day() != 5 {
		t.Fatalf("a single day: %v %v %v", start, end, err)
	}
	if _, end, err := ParseManagerReportRange("2026-09-01", "2026-09-30", now); err != nil || end.Day() != 15 {
		t.Fatalf("a range past today ends today: %v %v", end, err)
	}
	if _, _, err := ParseManagerReportRange("2026-09-10", "2026-09-02", now); err == nil {
		t.Fatal("a start after the end must be refused")
	}
	if _, _, err := ParseManagerReportRange("2026-09-20", "2026-09-25", now); err == nil {
		t.Fatal("a range wholly in the future must be refused")
	}
	if _, _, err := ParseManagerReportRange("2026-06-01", "2026-09-15", now); err == nil {
		t.Fatal("more than 93 days must be refused")
	}
	if _, _, err := ParseManagerReportRange("2026-6-1", "2026-09-15", now); err == nil {
		t.Fatal("a malformed date must be refused")
	}
}
