package service

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

const customerTableTokenBytes = 24

func tableFromRequest(repo *repository.TableRepository, restaurantID uint, req *TableRequest) (*entity.RestaurantTable, []entity.TableTag, error) {
	capacity := req.Capacity
	normalizedCapacity, err := normalizeCapacity(capacity)
	if err != nil {
		return nil, nil, err
	}
	status := strings.TrimSpace(req.Status)
	if status == "" {
		status = entity.TableStatusFree
	}
	if !isValidTableStatus(status) {
		return nil, nil, errors.New("invalid table status")
	}
	zone, zoneID, err := zoneContext(repo, restaurantID, req.ZoneID)
	if err != nil {
		return nil, nil, err
	}
	tags, err := repo.FindTags(restaurantID, req.TagIDs)
	if err != nil {
		return nil, nil, err
	}
	if len(tags) != len(uniqueUint(req.TagIDs)) {
		return nil, nil, errors.New("one or more table tags were not found")
	}
	next, err := repo.NextSequence(restaurantID, zoneID)
	if err != nil {
		return nil, nil, err
	}
	next, label, err := nextFreeTableLabel(repo, restaurantID, zone, next)
	if err != nil {
		return nil, nil, err
	}
	customerToken, err := GenerateCustomerTableToken()
	if err != nil {
		return nil, nil, err
	}
	return &entity.RestaurantTable{
		RestaurantID:   restaurantID,
		ZoneID:         zoneID,
		TableNumber:    label,
		DisplayLabel:   label,
		SequenceNumber: next,
		Capacity:       normalizedCapacity,
		Zone:           zoneName(zone),
		Status:         status,
		CustomerToken:  customerToken,
	}, tags, nil
}

func isValidTableStatus(status string) bool {
	return status == entity.TableStatusFree ||
		status == entity.TableStatusOccupied ||
		status == entity.TableStatusReserved ||
		status == entity.TableStatusInactive
}

func isValidReservationPhone(phone string) bool {
	digits := 0
	for _, char := range phone {
		if char >= '0' && char <= '9' {
			digits++
		}
	}
	return digits >= 9
}

// reservationPhoneDigits reduces a phone to what identifies the guest, so the
// separators a staffer happens to type are not part of the comparison.
func reservationPhoneDigits(phone string) string {
	digits := make([]rune, 0, len(phone))
	for _, char := range phone {
		if char >= '0' && char <= '9' {
			digits = append(digits, char)
		}
	}
	return string(digits)
}

// sameReservationPhone decides whether two bookings are for the same guest.
// `081-234-5678` and `0812345678` are one person; treating them as two is how a
// duplicate slips through the guard that is meant to catch it.
func sameReservationPhone(left, right string) bool {
	return reservationPhoneDigits(left) == reservationPhoneDigits(right)
}

// normalizeReservationGuestCount keeps the column's CHECK satisfiable from any
// caller. Zero is what an older client that does not send the field looks like,
// and it means "not stated", not "nobody".
func normalizeReservationGuestCount(guestCount int) int {
	if guestCount < 1 {
		return 1
	}
	if guestCount > 9999 {
		return 9999
	}
	return guestCount
}

func validateTableCanBeReserved(status string) error {
	if status != entity.TableStatusFree {
		return errors.New("table is not free")
	}
	return nil
}

func validateReservedTableRelease(status string, hasOpenOrder bool) error {
	if status != entity.TableStatusReserved {
		return errors.New("table is not reserved")
	}
	if hasOpenOrder {
		return errors.New("table has an open order")
	}
	return nil
}

// tableStatusForMetadataUpdate keeps reservation/order lifecycle status owned
// by their dedicated workflows while still allowing table metadata to change.
func tableStatusForMetadataUpdate(current, requested string) string {
	if current == entity.TableStatusReserved || current == entity.TableStatusOccupied {
		return current
	}
	return requested
}

func validateMetadataTableStatus(current, requested string) error {
	if current == entity.TableStatusReserved || current == entity.TableStatusOccupied {
		return nil
	}
	if requested != entity.TableStatusFree && requested != entity.TableStatusInactive {
		return errors.New("table status must be free or inactive")
	}
	return nil
}

func applyTableMetadataUpdate(table, requested *entity.RestaurantTable) {
	table.Capacity = requested.Capacity
	table.Status = tableStatusForMetadataUpdate(table.Status, requested.Status)
	if table.Status != entity.TableStatusReserved {
		table.ReservationName = ""
		table.ReservationPhone = ""
	}
}

func GenerateCustomerTableToken() (string, error) {
	bytes := make([]byte, customerTableTokenBytes)
	if _, err := rand.Read(bytes); err != nil {
		return "", errors.New("failed to generate customer table token")
	}
	return hex.EncodeToString(bytes), nil
}

func normalizeCustomerTableToken(token string) (string, error) {
	token = strings.TrimSpace(token)
	if len(token) != customerTableTokenBytes*2 {
		return "", errors.New("table QR code is not valid")
	}
	decoded, err := hex.DecodeString(token)
	if err != nil || len(decoded) != customerTableTokenBytes {
		return "", errors.New("table QR code is not valid")
	}
	return token, nil
}

func normalizeCapacity(capacity int) (int, error) {
	if capacity == 0 {
		capacity = 2
	}
	if capacity < 1 || capacity > 50 {
		return 0, errors.New("capacity must be between 1 and 50")
	}
	return capacity, nil
}

func zoneContext(repo *repository.TableRepository, restaurantID uint, zoneID *uint) (*entity.TableZone, *uint, error) {
	if zoneID == nil || *zoneID == 0 {
		return nil, nil, nil
	}
	zone, err := repo.FindZone(restaurantID, *zoneID)
	if err != nil {
		return nil, nil, errors.New("table zone not found")
	}
	return zone, &zone.ID, nil
}

// nextFreeTableLabel advances the zone's sequence past any label the restaurant
// is already using, and returns the sequence and label to create with.
//
// Sequences are per zone but `table_number` is unique per restaurant, so two
// zones reach the same label independently: zone-less tables are `T<n>` and a
// zone whose prefix is "T" is `T%02d`, identical from 10 upwards. The insert
// then fails on the unique index and the owner is told the table already exists
// while looking at a screen where no such table is visible — with no way to get
// past it, because the sequence never moves.
//
// Bounded: if this many consecutive labels are taken, something is wrong and an
// honest error beats spinning.
const maxTableLabelProbes = 500

func nextFreeTableLabel(
	repo *repository.TableRepository,
	restaurantID uint,
	zone *entity.TableZone,
	sequence int,
) (int, string, error) {
	for attempt := 0; attempt < maxTableLabelProbes; attempt++ {
		label := tableLabel(zone, sequence)
		taken, err := repo.TableNumberTaken(restaurantID, label)
		if err != nil {
			return 0, "", err
		}
		if !taken {
			return sequence, label, nil
		}
		sequence++
	}
	return 0, "", errors.New("could not find an unused table number")
}

func tableLabel(zone *entity.TableZone, sequence int) string {
	if zone == nil {
		return fmt.Sprintf("T%d", sequence)
	}
	prefix := strings.TrimSpace(zone.Prefix)
	if prefix == "" {
		prefix = "Z"
	}
	return fmt.Sprintf("%s%02d", prefix, sequence)
}

func zoneName(zone *entity.TableZone) string {
	if zone == nil {
		return ""
	}
	return zone.Name
}

func zoneFromRequest(repo *repository.TableRepository, restaurantID, currentID uint, req *TableZoneRequest) (*entity.TableZone, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("zone name is required")
	}
	prefix := strings.ToUpper(strings.TrimSpace(req.Prefix))
	if len(prefix) > 8 {
		return nil, errors.New("zone prefix must be 8 characters or fewer")
	}
	if prefix == "" {
		for suffix := 1; ; suffix++ {
			candidate := "Z"
			if suffix > 1 {
				candidate = fmt.Sprintf("Z%d", suffix)
			}
			exists, err := repo.PrefixExists(restaurantID, candidate, currentID)
			if err != nil {
				return nil, err
			}
			if !exists {
				prefix = candidate
				break
			}
		}
	} else {
		exists, err := repo.PrefixExists(restaurantID, prefix, currentID)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, errors.New("zone prefix is already used")
		}
	}
	zone := &entity.TableZone{
		RestaurantID: restaurantID,
		Name:         name,
		Prefix:       prefix,
		DisplayOrder: req.DisplayOrder,
		IsActive:     true,
	}
	if req.IsActive != nil {
		zone.IsActive = *req.IsActive
	}
	return zone, nil
}

func tagFromRequest(restaurantID uint, req *TableTagRequest) (*entity.TableTag, error) {
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return nil, errors.New("tag name is required")
	}
	color := strings.TrimSpace(req.Color)
	if color == "" {
		color = "gray"
	}
	if !validTagColor(color) {
		return nil, errors.New("invalid tag color")
	}
	tag := &entity.TableTag{
		RestaurantID: restaurantID,
		Name:         name,
		Color:        color,
		DisplayOrder: req.DisplayOrder,
		IsActive:     true,
	}
	if req.IsActive != nil {
		tag.IsActive = *req.IsActive
	}
	return tag, nil
}

func validTagColor(color string) bool {
	switch color {
	case "gray", "orange", "sky", "emerald", "amber":
		return true
	default:
		return false
	}
}

func uniqueUint(values []uint) []uint {
	seen := map[uint]bool{}
	unique := []uint{}
	for _, value := range values {
		if value == 0 || seen[value] {
			continue
		}
		seen[value] = true
		unique = append(unique, value)
	}
	return unique
}
