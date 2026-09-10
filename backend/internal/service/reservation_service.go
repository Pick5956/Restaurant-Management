package service

import (
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// staleScheduledBookingAge is how long past its time a booking waits before the
// system closes it as a no-show.
//
// Four hours, not one: a guest can be very late and still turn up, and a booking
// closed under a party that is on its way is worse than one that lingers an
// extra hour. Long enough to cover a whole service, short enough that the list
// does not fill with last week.
const staleScheduledBookingAge = 4 * time.Hour

type ReservationService struct {
	repo *repository.ReservationRepository
}

func ProvideReservationService(repo *repository.ReservationRepository) *ReservationService {
	return &ReservationService{repo: repo}
}

type ReservationListResult struct {
	Reservations []entity.Reservation
	HasMore      bool
	NextOffset   int
	Counts       map[string]int64
}

// ListReservations returns the reservation history, newest first. status ""
// returns all outcomes; otherwise it filters to active/seated/cancelled.
func (s *ReservationService) ListReservations(restaurantID uint, status string, limit, offset int) (*ReservationListResult, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	if status != "" && status != entity.ReservationStatusActive &&
		status != entity.ReservationStatusSeated && status != entity.ReservationStatusCancelled {
		status = ""
	}

	// Swept here rather than on a timer: this list is the only place stale
	// bookings are ever looked at, so reading it is exactly when they need to be
	// correct, and a single-process backend has no scheduler to hang a job on.
	// Failing to sweep must not fail the read — the rows are still true, just
	// with a few that should have closed themselves.
	now := repository.BangkokNow()
	_, _ = s.repo.ExpireStaleScheduled(restaurantID, now.Add(-staleScheduledBookingAge), now)

	rows, err := s.repo.List(restaurantID, status, limit+1, offset)
	if err != nil {
		return nil, err
	}
	hasMore := len(rows) > limit
	if hasMore {
		rows = rows[:limit]
	}
	counts, err := s.repo.CountByStatus(restaurantID)
	if err != nil {
		return nil, err
	}
	return &ReservationListResult{
		Reservations: rows,
		HasMore:      hasMore,
		NextOffset:   offset + len(rows),
		Counts:       counts,
	}, nil
}
