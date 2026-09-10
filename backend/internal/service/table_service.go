package service

import (
	"errors"
	"strings"
	"time"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type TableService struct {
	repo *repository.TableRepository
}

func ProvideTableService(repo *repository.TableRepository) *TableService {
	return &TableService{repo: repo}
}

type TableRequest struct {
	ZoneID   *uint  `json:"zone_id"`
	Capacity int    `json:"capacity"`
	Status   string `json:"status"`
	TagIDs   []uint `json:"tag_ids"`
}

type BulkCreateTablesRequest struct {
	ZoneID   *uint  `json:"zone_id"`
	Count    int    `json:"count" binding:"required"`
	Capacity int    `json:"capacity"`
	Status   string `json:"status"`
	TagIDs   []uint `json:"tag_ids"`
}

type MoveTableZoneRequest struct {
	ZoneID *uint `json:"zone_id"`
}

type TableZoneRequest struct {
	Name         string `json:"name" binding:"required"`
	Prefix       string `json:"prefix"`
	DisplayOrder int    `json:"display_order"`
	IsActive     *bool  `json:"is_active"`
}

type TableTagRequest struct {
	Name         string `json:"name" binding:"required"`
	Color        string `json:"color"`
	DisplayOrder int    `json:"display_order"`
	IsActive     *bool  `json:"is_active"`
}

func (s *TableService) ListTables(restaurantID uint) ([]entity.RestaurantTable, error) {
	tables, err := s.repo.ListTables(restaurantID)
	if err != nil {
		return nil, err
	}
	// A failure to look up bookings must not cost the floor its table map: the
	// reminder is an extra on the card, and losing it is far cheaper than
	// losing the ability to open a table.
	upcoming, err := s.repo.UpcomingReservationsByTable(restaurantID, repository.BangkokNow())
	if err != nil {
		return tables, nil
	}
	for index := range tables {
		reservation, ok := upcoming[tables[index].ID]
		if !ok {
			continue
		}
		tables[index].UpcomingReservationAt = reservation.ReservedFor
		tables[index].UpcomingReservationName = reservation.Name
	}
	return tables, nil
}

func (s *TableService) CreateTable(restaurantID uint, req *TableRequest) (*entity.RestaurantTable, error) {
	var created *entity.RestaurantTable
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, tags, err := tableFromRequest(tx, restaurantID, req)
		if err != nil {
			return err
		}
		if err := validateMetadataTableStatus(entity.TableStatusFree, table.Status); err != nil {
			return err
		}
		if err := tx.CreateTable(table); err != nil {
			return err
		}
		if err := tx.ReplaceTableTags(table, tags); err != nil {
			return err
		}
		created = table
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, created.ID)
}

func (s *TableService) UpdateTable(restaurantID, tableID uint, req *TableRequest) (*entity.RestaurantTable, error) {
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		next, tags, err := tableFromRequest(tx, restaurantID, req)
		if err != nil {
			return err
		}
		if err := validateMetadataTableStatus(table.Status, next.Status); err != nil {
			return err
		}
		hasOpenOrder, err := tx.HasOpenOrderForTable(restaurantID, tableID)
		if err != nil {
			return err
		}
		applyTableMetadataUpdate(table, next)
		if hasOpenOrder && table.Status != entity.TableStatusOccupied {
			return errors.New("table has an open order")
		}
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		if err := tx.ReplaceTableTags(table, tags); err != nil {
			return err
		}
		updatedID = table.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

func (s *TableService) UpdateTableStatus(restaurantID, userID, tableID uint, status string, reservationPhone string, reservationName string) (*entity.RestaurantTable, error) {
	status = strings.TrimSpace(status)
	if !isValidTableStatus(status) {
		return nil, errors.New("invalid table status")
	}
	reservationPhone = strings.TrimSpace(reservationPhone)
	reservationName = strings.TrimSpace(reservationName)
	if status == entity.TableStatusReserved && !isValidReservationPhone(reservationPhone) {
		return nil, errors.New("reservation phone is required")
	}
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		hasOpenOrder, err := tx.HasOpenOrderForTable(restaurantID, tableID)
		if err != nil {
			return err
		}
		if hasOpenOrder && status != entity.TableStatusOccupied {
			return errors.New("table has an open order")
		}
		wasReserved := table.Status == entity.TableStatusReserved
		activeReservation, err := findActiveReservation(tx, restaurantID, tableID)
		if err != nil {
			return err
		}
		if status == entity.TableStatusOccupied {
			if wasReserved || activeReservation != nil {
				return errors.New("reservation seating requires opening an order")
			}
			if !hasOpenOrder {
				return errors.New("table occupation requires opening an order")
			}
		}
		if status == entity.TableStatusReserved {
			if activeReservation == nil {
				activeReservation = reservationForTable(table, userID, reservationPhone, reservationName)
				if err := tx.CreateReservation(activeReservation); err != nil {
					return err
				}
			}
			activeReservation.Name = reservationName
			activeReservation.Phone = reservationPhone
			if err := tx.UpdateReservation(activeReservation); err != nil {
				return err
			}
		} else if wasReserved || activeReservation != nil {
			if activeReservation == nil {
				activeReservation = reservationForTable(table, userID, table.ReservationPhone, table.ReservationName)
				if err := tx.CreateReservation(activeReservation); err != nil {
					return err
				}
			}
			if err := tx.ResolveActiveReservation(restaurantID, tableID, entity.ReservationStatusCancelled); err != nil {
				return err
			}
		}
		table.Status = status
		if status == entity.TableStatusReserved {
			table.ReservationName = reservationName
			table.ReservationPhone = reservationPhone
		} else {
			table.ReservationName = ""
			table.ReservationPhone = ""
		}
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		updatedID = table.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

// ReserveTable books a table. With reservedFor nil it holds the table now: the
// table switches to `reserved` and stops taking orders. With reservedFor set it
// records a booking for later and deliberately leaves the table alone, so the
// floor can keep selling it until the guests actually turn up. See the field
// comment on entity.Reservation.ReservedFor for why.
func (s *TableService) ReserveTable(restaurantID, userID, tableID uint, phone, name string, guestCount int, reservedFor *time.Time) (*entity.RestaurantTable, error) {
	phone = strings.TrimSpace(phone)
	name = strings.TrimSpace(name)
	if !isValidReservationPhone(phone) {
		return nil, errors.New("reservation phone is required")
	}
	guestCount = normalizeReservationGuestCount(guestCount)
	if reservedFor != nil {
		// Truncated so "the same slot" is a question the database can answer.
		// Bookings are taken on the quarter hour, so nothing is lost, but the
		// client sends a full ISO instant and a stray sub-minute component would
		// slide a duplicate straight past both the check below and the unique
		// index behind it.
		slot := reservedFor.Truncate(time.Minute)
		return s.scheduleReservation(restaurantID, userID, tableID, phone, name, guestCount, slot)
	}
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		if err := validateTableCanBeReserved(table.Status); err != nil {
			return err
		}
		activeReservation, err := findActiveReservation(tx, restaurantID, tableID)
		if err != nil {
			return err
		}
		hasOpenOrder, err := tx.HasOpenOrderForTable(restaurantID, tableID)
		if err != nil {
			return err
		}
		if hasOpenOrder {
			return errors.New("table has an open order")
		}
		table.Status = entity.TableStatusReserved
		table.ReservationName = name
		table.ReservationPhone = phone
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		reservation := reservationForTable(table, userID, phone, name)
		if activeReservation == nil {
			if err := tx.CreateReservation(reservation); err != nil {
				return err
			}
		} else {
			activeReservation.TableLabel = reservation.TableLabel
			activeReservation.Name = reservation.Name
			activeReservation.Phone = reservation.Phone
			activeReservation.ReservedByUserID = reservation.ReservedByUserID
			activeReservation.ResolvedAt = nil
			if err := tx.UpdateReservation(activeReservation); err != nil {
				return err
			}
		}
		updatedID = table.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

// scheduleReservation records a booking for later without touching the table.
//
// It deliberately skips both guards the hold path applies. The `free`-only check
// is wrong here because a table with guests on it right now is exactly the table
// you want to book for tonight, and the open-order check is wrong for the same
// reason. Nothing about this row stops the floor selling the table meanwhile;
// it is a note with a time on it.
func (s *TableService) scheduleReservation(restaurantID, userID, tableID uint, phone, name string, guestCount int, reservedFor time.Time) (*entity.RestaurantTable, error) {
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		if table.Status == entity.TableStatusInactive {
			return errors.New("table is inactive")
		}
		// One table, one booking per instant. Skipping this is how the same
		// booking came to be filed twice: nothing between the table lock and the
		// insert ever looked for a row that was already there, so a second tap —
		// or a staffer re-submitting after a slow request that looked like it had
		// failed — wrote a second identical row, and both showed as active.
		existing, err := tx.FindScheduledReservationForUpdate(restaurantID, tableID, reservedFor)
		if err != nil {
			return err
		}
		if existing != nil {
			if !sameReservationPhone(existing.Phone, phone) {
				return errors.New("table is already booked for that time")
			}
			// The same guest, the same table, the same instant: this is the one
			// booking arriving twice. Absorb it. Reporting an error for the
			// staffer's own second tap would be a warning about nothing, and the
			// screen closes on success either way, so nothing is hidden.
			updatedID = table.ID
			return nil
		}
		reservation := reservationForTable(table, userID, phone, name)
		reservation.GuestCount = guestCount
		reservation.ReservedFor = &reservedFor
		// Always a new row, never a reuse of the table's open hold: one table can
		// carry several bookings at different times, and folding them into one
		// another would silently overwrite somebody's booking.
		if err := tx.CreateReservation(reservation); err != nil {
			return err
		}
		updatedID = table.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

// ResolveReservation closes one booking by its own id, as seated or cancelled.
//
// The table-keyed cancel below only reaches a booking that holds its table, which
// a scheduled booking never does — so before this there was no way to close one
// at all, and they accumulated as `active` forever.
//
// Freeing the table is part of resolving a hold, because a hold is the thing
// holding it. A scheduled booking never touched the table's status, so resolving
// one leaves the floor exactly as it was.
func (s *TableService) ResolveReservation(restaurantID, userID, reservationID uint, outcome string) (*entity.Reservation, error) {
	if outcome != entity.ReservationStatusSeated && outcome != entity.ReservationStatusCancelled {
		return nil, errors.New("reservation outcome must be seated or cancelled")
	}
	var resolved *entity.Reservation
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		// Unlocked, and only to learn which table this booking belongs to.
		//
		// The lock order below is not a preference. Every other path that holds
		// both rows — the table-keyed cancel, the hold path, UpdateTableStatus,
		// OrderService.OpenOrder — locks restaurant_tables first and reaches the
		// reservation second. Locking the reservation first here made this the
		// one path running the other way round, so cancelling a hold from the
		// history list while someone seated the same table deadlocked: Postgres
		// aborted one of them and that staffer's tap failed outright. Measured at
		// 205 deadlocks in 300 overlapping attempts before this changed.
		booking, err := tx.FindReservation(restaurantID, reservationID)
		if err != nil {
			return errors.New("reservation not found")
		}
		// Taken even for a scheduled booking, which does not touch the table.
		// The lock is brief and an unconditional order is worth more than the
		// contention it saves: a rule with an exception is a rule the next
		// caller gets wrong.
		table, err := tx.FindTableForUpdate(restaurantID, booking.TableID)
		if err != nil {
			return err
		}
		reservation, err := tx.FindReservationForUpdate(restaurantID, reservationID)
		if err != nil {
			return errors.New("reservation not found")
		}
		if reservation.Status != entity.ReservationStatusActive {
			return errors.New("reservation is already resolved")
		}
		// The unlocked read is only trusted for the table it named. If the row
		// moved between the two reads, the table under lock is the wrong one.
		if reservation.TableID != booking.TableID {
			return errors.New("reservation changed while it was being resolved")
		}
		if reservation.ReservedFor == nil {
			hasOpenOrder, err := tx.HasOpenOrderForTable(restaurantID, reservation.TableID)
			if err != nil {
				return err
			}
			// Only free a table this booking is actually holding, and never out
			// from under an open order: the booking record still closes either
			// way, but the floor state is left to whoever owns it.
			if table.Status == entity.TableStatusReserved && !hasOpenOrder {
				table.Status = entity.TableStatusFree
				table.ReservationName = ""
				table.ReservationPhone = ""
				if err := tx.UpdateTable(table); err != nil {
					return err
				}
			}
		}
		now := repository.BangkokNow()
		reservation.Status = outcome
		reservation.ResolvedAt = &now
		if err := tx.UpdateReservation(reservation); err != nil {
			return err
		}
		resolved = reservation
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resolved, nil
}

// CancelReservation frees a reserved table and marks its reservation cancelled.
func (s *TableService) CancelReservation(restaurantID, userID, tableID uint) (*entity.RestaurantTable, error) {
	return s.releaseReservedTable(restaurantID, userID, tableID, entity.ReservationStatusCancelled)
}

func (s *TableService) releaseReservedTable(restaurantID, userID, tableID uint, outcome string) (*entity.RestaurantTable, error) {
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		hasOpenOrder, err := tx.HasOpenOrderForTable(restaurantID, tableID)
		if err != nil {
			return err
		}
		activeReservation, err := findActiveReservation(tx, restaurantID, tableID)
		if err != nil {
			return err
		}
		if table.Status == entity.TableStatusReserved {
			if err := validateReservedTableRelease(table.Status, hasOpenOrder); err != nil {
				return err
			}
		} else {
			if hasOpenOrder {
				return errors.New("table has an open order")
			}
			if activeReservation == nil {
				return errors.New("table is not reserved")
			}
		}
		if activeReservation == nil {
			activeReservation = reservationForTable(table, userID, table.ReservationPhone, table.ReservationName)
			if err := tx.CreateReservation(activeReservation); err != nil {
				return err
			}
		}
		table.Status = entity.TableStatusFree
		table.ReservationName = ""
		table.ReservationPhone = ""
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		updatedID = table.ID
		return tx.ResolveActiveReservation(restaurantID, tableID, outcome)
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

func (s *TableService) RegenerateCustomerToken(restaurantID, tableID uint) (*entity.RestaurantTable, error) {
	var updatedID uint
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		customerToken, err := GenerateCustomerTableToken()
		if err != nil {
			return err
		}
		table.CustomerToken = customerToken
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		updatedID = table.ID
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, updatedID)
}

func (s *TableService) DeleteTable(restaurantID, tableID uint) error {
	return s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		hasActiveReservation, err := tx.HasActiveReservation(restaurantID, tableID)
		if err != nil {
			return err
		}
		if table.Status == entity.TableStatusReserved || hasActiveReservation {
			return errors.New("table has an active reservation; cancel it first")
		}
		referenced, err := tx.HasAnyOrderForTable(restaurantID, tableID)
		if err != nil {
			return err
		}
		if referenced {
			return errors.New("table has order history; mark it inactive instead")
		}
		return tx.DeleteTable(table)
	})
}

func findActiveReservation(tx *repository.TableRepository, restaurantID, tableID uint) (*entity.Reservation, error) {
	return tx.ReconcileActiveReservationsForUpdate(restaurantID, tableID)
}

func reservationForTable(table *entity.RestaurantTable, userID uint, phone, name string) *entity.Reservation {
	label := table.DisplayLabel
	if strings.TrimSpace(label) == "" {
		label = table.TableNumber
	}
	return &entity.Reservation{
		RestaurantID:     table.RestaurantID,
		TableID:          table.ID,
		TableLabel:       label,
		Name:             name,
		Phone:            phone,
		Status:           entity.ReservationStatusActive,
		ReservedByUserID: userID,
	}
}

func (s *TableService) BulkCreateTables(restaurantID uint, req *BulkCreateTablesRequest) ([]entity.RestaurantTable, error) {
	count := req.Count
	if count < 1 || count > 200 {
		return nil, errors.New("count must be between 1 and 200")
	}
	capacity, err := normalizeCapacity(req.Capacity)
	if err != nil {
		return nil, err
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = entity.TableStatusFree
	}
	if !isValidTableStatus(status) {
		return nil, errors.New("invalid table status")
	}
	if err := validateMetadataTableStatus(entity.TableStatusFree, status); err != nil {
		return nil, err
	}
	var created []entity.RestaurantTable
	err = s.repo.Transaction(func(tx *repository.TableRepository) error {
		zone, zoneID, err := zoneContext(tx, restaurantID, req.ZoneID)
		if err != nil {
			return err
		}
		tags, err := tx.FindTags(restaurantID, req.TagIDs)
		if err != nil {
			return err
		}
		if len(tags) != len(uniqueUint(req.TagIDs)) {
			return errors.New("one or more table tags were not found")
		}
		next, err := tx.NextSequence(restaurantID, zoneID)
		if err != nil {
			return err
		}
		for i := 0; i < count; i++ {
			// Each label is looked up rather than derived from the loop index:
			// sequences run per zone but table_number is unique per restaurant, so
			// a zone can walk straight into a label another zone already holds
			// (`T10` from the zone-less numbering and from a zone prefixed "T").
			// Advancing `next` past every one it takes also keeps the rest of this
			// batch clear of it.
			sequence, label, err := nextFreeTableLabel(tx, restaurantID, zone, next+i)
			if err != nil {
				return err
			}
			next = sequence - i
			customerToken, err := GenerateCustomerTableToken()
			if err != nil {
				return err
			}
			table := &entity.RestaurantTable{
				RestaurantID:   restaurantID,
				ZoneID:         zoneID,
				TableNumber:    label,
				DisplayLabel:   label,
				SequenceNumber: sequence,
				Capacity:       capacity,
				Zone:           zoneName(zone),
				Status:         status,
				CustomerToken:  customerToken,
			}
			if err := tx.CreateTable(table); err != nil {
				return err
			}
			if err := tx.ReplaceTableTags(table, tags); err != nil {
				return err
			}
			created = append(created, *table)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.ListTables(restaurantID)
}

func (s *TableService) MoveTableZone(restaurantID, tableID uint, req *MoveTableZoneRequest) (*entity.RestaurantTable, error) {
	var moved *entity.RestaurantTable
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		table, err := tx.FindTableForUpdate(restaurantID, tableID)
		if err != nil {
			return err
		}
		zone, zoneID, err := zoneContext(tx, restaurantID, req.ZoneID)
		if err != nil {
			return err
		}
		next, err := tx.NextSequence(restaurantID, zoneID)
		if err != nil {
			return err
		}
		label := tableLabel(zone, next)
		table.ZoneID = zoneID
		table.Zone = zoneName(zone)
		table.SequenceNumber = next
		table.DisplayLabel = label
		table.TableNumber = label
		if err := tx.UpdateTable(table); err != nil {
			return err
		}
		moved = table
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.repo.FindTable(restaurantID, moved.ID)
}

func (s *TableService) ListZones(restaurantID uint) ([]entity.TableZone, error) {
	return s.repo.ListZones(restaurantID)
}

func (s *TableService) CreateZone(restaurantID uint, req *TableZoneRequest) (*entity.TableZone, error) {
	zone, err := zoneFromRequest(s.repo, restaurantID, 0, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateZone(zone); err != nil {
		return nil, err
	}
	return zone, nil
}

func (s *TableService) UpdateZone(restaurantID, zoneID uint, req *TableZoneRequest) (*entity.TableZone, error) {
	var updated *entity.TableZone
	err := s.repo.Transaction(func(tx *repository.TableRepository) error {
		zone, err := tx.FindZone(restaurantID, zoneID)
		if err != nil {
			return err
		}
		next, err := zoneFromRequest(tx, restaurantID, zoneID, req)
		if err != nil {
			return err
		}
		prefixChanged := strings.TrimSpace(zone.Prefix) != strings.TrimSpace(next.Prefix)
		nameChanged := zone.Name != next.Name
		zone.Name = next.Name
		zone.Prefix = next.Prefix
		zone.DisplayOrder = next.DisplayOrder
		zone.IsActive = next.IsActive
		if err := tx.UpdateZone(zone); err != nil {
			return err
		}
		if prefixChanged || nameChanged {
			tables, err := tx.ListTablesInZone(restaurantID, zone.ID)
			if err != nil {
				return err
			}
			for i := range tables {
				tables[i].Zone = zone.Name
				if prefixChanged {
					label := tableLabel(zone, tables[i].SequenceNumber)
					tables[i].TableNumber = label
					tables[i].DisplayLabel = label
				}
				if err := tx.UpdateTable(&tables[i]); err != nil {
					return err
				}
			}
		}
		updated = zone
		return nil
	})
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *TableService) DeleteZone(restaurantID, zoneID uint) error {
	zone, err := s.repo.FindZone(restaurantID, zoneID)
	if err != nil {
		return err
	}
	count, err := s.repo.CountTablesInZone(restaurantID, zoneID)
	if err != nil {
		return err
	}
	if count > 0 {
		return errors.New("cannot delete a zone that still has tables")
	}
	return s.repo.DeleteZone(zone)
}

func (s *TableService) ListTags(restaurantID uint) ([]entity.TableTag, error) {
	return s.repo.ListTags(restaurantID)
}

func (s *TableService) CreateTag(restaurantID uint, req *TableTagRequest) (*entity.TableTag, error) {
	tag, err := tagFromRequest(restaurantID, req)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateTag(tag); err != nil {
		return nil, err
	}
	return tag, nil
}

func (s *TableService) UpdateTag(restaurantID, tagID uint, req *TableTagRequest) (*entity.TableTag, error) {
	tag, err := s.repo.FindTag(restaurantID, tagID)
	if err != nil {
		return nil, err
	}
	next, err := tagFromRequest(restaurantID, req)
	if err != nil {
		return nil, err
	}
	tag.Name = next.Name
	tag.Color = next.Color
	tag.DisplayOrder = next.DisplayOrder
	tag.IsActive = next.IsActive
	if err := s.repo.UpdateTag(tag); err != nil {
		return nil, err
	}
	return tag, nil
}

func (s *TableService) DeleteTag(restaurantID, tagID uint) error {
	tag, err := s.repo.FindTag(restaurantID, tagID)
	if err != nil {
		return err
	}
	return s.repo.DeleteTag(tag)
}
