package aitools

import (
	"testing"
	"time"
)

// "30 วันล่าสุด" is thirty whole calendar days ending today, for every tool: a
// window opening at this minute 30×24h ago made the profit sheet and the
// payment-mix sheet disagree on the same question (28 ก.ย. 2569).
func TestRollingWindowStartIsMidnightTwentyNineDaysBack(t *testing.T) {
	loc, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		t.Skip(err)
	}
	now := time.Date(2026, 9, 28, 11, 7, 0, 0, loc)
	want := time.Date(2026, 8, 30, 0, 0, 0, 0, loc)
	if got := RollingWindowStart(now); !got.Equal(want) {
		t.Fatalf("RollingWindowStart(%s) = %s, want %s", now, got, want)
	}
	// Just after midnight the window still spans thirty dates.
	early := time.Date(2026, 9, 28, 0, 1, 0, 0, loc)
	if got := RollingWindowStart(early); !got.Equal(want) {
		t.Fatalf("RollingWindowStart(%s) = %s, want %s", early, got, want)
	}
}
