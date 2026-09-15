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
