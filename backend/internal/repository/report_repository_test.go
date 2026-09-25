package repository

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type statementCapture struct {
	statements []string
}

func (capture *statementCapture) LogMode(logger.LogLevel) logger.Interface { return capture }
func (capture *statementCapture) Info(context.Context, string, ...interface{}) {
}
func (capture *statementCapture) Warn(context.Context, string, ...interface{}) {
}
func (capture *statementCapture) Error(context.Context, string, ...interface{}) {
}
func (capture *statementCapture) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	statement, _ := fc()
	capture.statements = append(capture.statements, strings.ToLower(statement))
}

func dryRunRepositoryDB(t *testing.T) (*gorm.DB, *statementCapture) {
	t.Helper()
	capture := &statementCapture{}
	db, err := gorm.Open(
		postgres.New(postgres.Config{
			DSN:                  "host=localhost user=test dbname=test sslmode=disable",
			PreferSimpleProtocol: true,
		}),
		&gorm.Config{
			DryRun:               true,
			DisableAutomaticPing: true,
			Logger:               capture,
		},
	)
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}
	return db, capture
}

func requirePaidCompletedCohort(t *testing.T, statements []string) {
	t.Helper()
	joined := strings.Join(statements, "\n")
	for _, fragment := range []string{"status = 'completed'", "payment_status = 'paid'"} {
		if !strings.Contains(joined, fragment) {
			t.Fatalf("generated SQL does not constrain revenue cohort by %q:\n%s", fragment, joined)
		}
	}
}

func TestReportRevenueQueriesUseOnlyPaidCompletedOrders(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewReportRepository(db)
	since := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.FixedZone("Asia/Bangkok", 7*60*60))

	if _, err := repo.SalesByDay(7, since); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("SalesByDay() error = %v", err)
	}
	if _, err := repo.MenuMargins(7, since); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("MenuMargins() error = %v", err)
	}
	requirePaidCompletedCohort(t, capture.statements)
}

func TestAIRevenueQueriesUseOnlyPaidCompletedOrders(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewAIRepository(db)
	since := time.Date(2026, time.July, 1, 0, 0, 0, 0, time.FixedZone("Asia/Bangkok", 7*60*60))

	if _, err := repo.RecentSalesSummary(7, since); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("RecentSalesSummary() error = %v", err)
	}
	if _, err := repo.TopMenuItems(7, since); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("TopMenuItems() error = %v", err)
	}
	requirePaidCompletedCohort(t, capture.statements)
}

// The hour view exists so a day's hours sum to that day's bar. That only holds
// while both go through salesBuckets with the same cohort filter and the hour
// query is fenced to one Bangkok day.
func TestSalesByHourMatchesDailyCohortAndStaysWithinOneDay(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewReportRepository(db)
	bangkok := time.FixedZone("Asia/Bangkok", 7*60*60)
	day := time.Date(2026, time.July, 1, 13, 45, 0, 0, bangkok)

	if _, err := repo.SalesByHour(7, day); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("SalesByHour() error = %v", err)
	}

	requirePaidCompletedCohort(t, capture.statements)

	// DryRun stops a multi-query call at the first Scan, so only the revenue
	// leg is observable here; the cost leg gets its cohort and bounds from the
	// same salesBuckets locals.
	hourly := strings.Join(capture.statements, "\n")
	if !strings.Contains(hourly, "'hh24'") {
		t.Fatalf("hourly query does not bucket by hour:\n%s", hourly)
	}
	// Without the exclusive upper bound the "hourly" query would silently fold
	// every later day into the same 24 buckets.
	if !strings.Contains(hourly, "completed_at < ") {
		t.Fatalf("hourly query is not bounded to a single day:\n%s", hourly)
	}
	// GROUP BY must repeat the whole expression. gorm quotes whatever Group()
	// receives, so an ordinal like Group("1") ships as GROUP BY "1" — valid SQL
	// text that Postgres rejects at runtime as an unknown column. DryRun builds
	// the statement without executing it, so only this assertion catches it.
	if !strings.Contains(hourly, "group by to_char(") {
		t.Fatalf("hourly query must group by the bucket expression, not an ordinal:\n%s", hourly)
	}

	dayDB, dayCapture := dryRunRepositoryDB(t)
	if _, err := NewReportRepository(dayDB).SalesByDay(7, day); err != nil && !errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("SalesByDay() error = %v", err)
	}
	daily := strings.Join(dayCapture.statements, "\n")
	if strings.Contains(daily, "completed_at < ") {
		t.Fatalf("the day view must stay open-ended, not inherit the hourly bound:\n%s", daily)
	}
	if !strings.Contains(daily, "'yyyy-mm-dd'") {
		t.Fatalf("day query lost its date bucket:\n%s", daily)
	}
}

// The drill-down table is opened from a bar and must sum back to it, so it has
// to select the same cohort as salesBuckets and stay inside the bar's window.
func TestSalesDetailUsesSameCohortAsChartBars(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewReportRepository(db)
	bangkok := time.FixedZone("Asia/Bangkok", 7*60*60)
	since := time.Date(2026, time.July, 1, 13, 0, 0, 0, bangkok)

	if _, err := repo.SalesDetail(7, since, since.Add(time.Hour), 300); err != nil &&
		!errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("SalesDetail() error = %v", err)
	}

	requirePaidCompletedCohort(t, capture.statements)

	joined := strings.Join(capture.statements, "\n")
	// Both ends are required: without the upper bound a single-hour drill-down
	// would list every later bill in the restaurant's history.
	if !strings.Contains(joined, "orders.completed_at >= ") || !strings.Contains(joined, "orders.completed_at < ") {
		t.Fatalf("detail query is not fenced to the bar's window:\n%s", joined)
	}
	if !strings.Contains(joined, "limit 300") {
		t.Fatalf("detail query must stay bounded by its limit:\n%s", joined)
	}
}

func TestSalesWindowSummaryUsesFullBarCohortWithoutRowLimit(t *testing.T) {
	db, capture := dryRunRepositoryDB(t)
	repo := NewReportRepository(db)
	bangkok := time.FixedZone("Asia/Bangkok", 7*60*60)
	since := time.Date(2026, time.August, 3, 0, 0, 0, 0, bangkok)

	if _, err := repo.SalesWindowSummary(7, since, since.AddDate(0, 0, 1)); err != nil &&
		!errors.Is(err, gorm.ErrDryRunModeUnsupported) {
		t.Fatalf("SalesWindowSummary() error = %v", err)
	}

	requirePaidCompletedCohort(t, capture.statements)
	joined := strings.Join(capture.statements, "\n")
	if strings.Contains(joined, "limit ") {
		t.Fatalf("sales summary must aggregate the full bar window:\n%s", joined)
	}
}

