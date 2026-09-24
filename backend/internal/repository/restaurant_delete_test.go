package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// restaurantDeleteLog records, in order, the transaction calls a fake
// connection receives and the SQL a dry-run session builds, so a test can see
// which statements ran inside which transaction.
type restaurantDeleteLog struct {
	events []string
}

func (l *restaurantDeleteLog) LogMode(logger.LogLevel) logger.Interface      { return l }
func (l *restaurantDeleteLog) Info(context.Context, string, ...interface{})  {}
func (l *restaurantDeleteLog) Warn(context.Context, string, ...interface{})  {}
func (l *restaurantDeleteLog) Error(context.Context, string, ...interface{}) {}
func (l *restaurantDeleteLog) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	statement, _ := fc()
	l.events = append(l.events, "sql: "+strings.ToLower(statement))
}

var errRestaurantDeleteNoDatabase = errors.New("dry run: no database behind this connection")

// restaurantDeleteStatements is what both connections share: a dry run never
// sends either of them a statement.
type restaurantDeleteStatements struct {
	log *restaurantDeleteLog
}

func (c *restaurantDeleteStatements) PrepareContext(context.Context, string) (*sql.Stmt, error) {
	return nil, errRestaurantDeleteNoDatabase
}
func (c *restaurantDeleteStatements) ExecContext(context.Context, string, ...interface{}) (sql.Result, error) {
	return nil, errRestaurantDeleteNoDatabase
}
func (c *restaurantDeleteStatements) QueryContext(context.Context, string, ...interface{}) (*sql.Rows, error) {
	return nil, errRestaurantDeleteNoDatabase
}
func (c *restaurantDeleteStatements) QueryRowContext(context.Context, string, ...interface{}) *sql.Row {
	return nil
}

// restaurantDeleteConn is the connection outside a transaction, which can
// begin one. Every lone write outside it would begin one too (GORM's default
// transaction), so a delete that is not wrapped shows up as two begins.
type restaurantDeleteConn struct {
	restaurantDeleteStatements
}

func (c *restaurantDeleteConn) BeginTx(context.Context, *sql.TxOptions) (gorm.ConnPool, error) {
	c.log.events = append(c.log.events, "begin")
	return &restaurantDeleteTx{restaurantDeleteStatements{log: c.log}}, nil
}

// restaurantDeleteTx is the connection inside a transaction. Like *sql.Tx it
// cannot begin another one.
type restaurantDeleteTx struct {
	restaurantDeleteStatements
}

func (t *restaurantDeleteTx) Commit() error {
	t.log.events = append(t.log.events, "commit")
	return nil
}
func (t *restaurantDeleteTx) Rollback() error {
	t.log.events = append(t.log.events, "rollback")
	return nil
}

func restaurantDeleteDB(t *testing.T) (*gorm.DB, *restaurantDeleteLog) {
	t.Helper()
	log := &restaurantDeleteLog{}
	db, err := gorm.Open(
		postgres.New(postgres.Config{Conn: &restaurantDeleteConn{restaurantDeleteStatements{log: log}}}),
		&gorm.Config{DryRun: true, DisableAutomaticPing: true, Logger: log},
	)
	if err != nil {
		t.Fatalf("open dry-run database: %v", err)
	}
	return db, log
}

// TestRestaurantDeleteTakesItsMembershipsInOneTransaction: the memberships used
// to be deleted on their own and then the restaurant, so a failure between the
// two left a live restaurant nobody belonged to.
func TestRestaurantDeleteTakesItsMembershipsInOneTransaction(t *testing.T) {
	db, log := restaurantDeleteDB(t)

	if err := NewRestaurantRepository(db).DeleteWithMemberships(42); err != nil {
		t.Fatalf("DeleteWithMemberships() error = %v", err)
	}

	joined := strings.Join(log.events, "\n")
	if len(log.events) != 4 || log.events[0] != "begin" || log.events[3] != "commit" {
		t.Fatalf("want begin, two deletes, commit; got:\n%s", joined)
	}
	members, restaurant := log.events[1], log.events[2]
	for _, fragment := range []string{`update "restaurant_members" set "deleted_at"=`, "restaurant_id = 42"} {
		if !strings.Contains(members, fragment) {
			t.Fatalf("membership delete is missing %q:\n%s", fragment, joined)
		}
	}
	for _, fragment := range []string{`update "restaurants" set "deleted_at"=`, `"restaurants"."id" = 42`} {
		if !strings.Contains(restaurant, fragment) {
			t.Fatalf("restaurant delete is missing %q:\n%s", fragment, joined)
		}
	}
}

// TestRestaurantDeleteFailureKeepsTheMemberships: when the restaurant row
// cannot be deleted, the membership delete before it is rolled back with it.
func TestRestaurantDeleteFailureKeepsTheMemberships(t *testing.T) {
	db, log := restaurantDeleteDB(t)
	refused := errors.New("restaurant delete refused")
	err := db.Callback().Delete().Before("gorm:delete").Register("test:refuse_restaurant_delete", func(tx *gorm.DB) {
		if tx.Statement.Table == "restaurants" {
			_ = tx.AddError(refused)
		}
	})
	if err != nil {
		t.Fatalf("register callback: %v", err)
	}

	if err := NewRestaurantRepository(db).DeleteWithMemberships(42); !errors.Is(err, refused) {
		t.Fatalf("DeleteWithMemberships() error = %v, want %v", err, refused)
	}

	joined := strings.Join(log.events, "\n")
	if len(log.events) != 3 || log.events[0] != "begin" || log.events[2] != "rollback" {
		t.Fatalf("want begin, the membership delete, rollback; got:\n%s", joined)
	}
	if !strings.Contains(log.events[1], `update "restaurant_members"`) {
		t.Fatalf("the rolled-back statement should be the membership delete:\n%s", joined)
	}
}
