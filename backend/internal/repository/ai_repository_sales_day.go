package repository

import (
	"time"

	"Project-M/internal/entity"
)

// Two reads that the sales tools were missing.
//
// SalesByDayForRange lets "which day sold the most" answer about a window the
// owner named rather than only the fixed thirty-day snapshot. Asked "สัปดาห์นี้
// วันไหนขายดีสุด" the assistant had no tool that could scope itself, fell back
// to the busiest-weekday tool, and answered "วันพฤหัสบดี 31 บิล" — a weekday
// counted in bills, for a question about a date counted in baht.
//
// SalesByStaffForRange answers "พนักงานคนไหนขายได้เยอะที่สุด", which the
// assistant refused with "ระบบยังไม่มีข้อมูลเรื่องพนักงาน". Every order carries
// a staff_id and always has: the data was there the whole time.

// AIStaffSales is one person's till for the window.
type AIStaffSales struct {
	StaffID uint    `json:"staff_id"`
	Name    string  `json:"name"`
	Orders  int64   `json:"orders"`
	Revenue float64 `json:"revenue"`
	Guests  int64   `json:"guests"`
}

// SalesByDayForRange is paid sales per calendar day in [start, end), in the
// shop's own timezone. Same definition of a sale as every other sales read:
// completed and paid, dated by when the bill closed.
func (r *AIRepository) SalesByDayForRange(restaurantID uint, start, end time.Time) ([]AISalesSummary, error) {
	var rows []AISalesSummary
	err := r.db.Model(&entity.Order{}).
		Select("TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS order_date, COUNT(*) AS orders, COALESCE(SUM(grand_total), 0) AS revenue").
		Where(
			"restaurant_id = ? AND completed_at >= ? AND completed_at < ? AND status = ? AND payment_status = ?",
			restaurantID, start, end,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("TO_CHAR(completed_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD')").
		Order("order_date asc").
		// One row per day; a year of days still fits well inside this.
		Limit(400).
		Scan(&rows).Error
	return rows, err
}

// SalesByStaffForRange ranks the people who closed the bills, by money taken.
//
// The join is left so a bill whose staff record was removed still counts toward
// the shop's total; it lands under an empty name, which the caller reports as
// "ไม่ระบุ" rather than dropping money out of the ranking.
func (r *AIRepository) SalesByStaffForRange(restaurantID uint, start, end time.Time) ([]AIStaffSales, error) {
	var rows []AIStaffSales
	err := r.db.Model(&entity.Order{}).
		Select(`orders.staff_id AS staff_id,
			COALESCE(NULLIF(TRIM(CONCAT(COALESCE(users.first_name, ''), ' ', COALESCE(users.last_name, ''))), ''), COALESCE(users.nickname, '')) AS name,
			COUNT(*) AS orders,
			COALESCE(SUM(orders.grand_total), 0) AS revenue,
			COALESCE(SUM(orders.customer_count), 0) AS guests`).
		Joins("LEFT JOIN users ON users.id = orders.staff_id").
		Where(
			"orders.restaurant_id = ? AND orders.completed_at >= ? AND orders.completed_at < ? AND orders.status = ? AND orders.payment_status = ?",
			restaurantID, start, end,
			entity.OrderStatusCompleted,
			entity.PaymentStatusPaid,
		).
		Group("orders.staff_id, users.first_name, users.last_name, users.nickname").
		Order("revenue desc").
		Limit(50).
		Scan(&rows).Error
	return rows, err
}
