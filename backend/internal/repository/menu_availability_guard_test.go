package repository

import (
	"os"
	"regexp"
	"testing"
)

// TestCommittedStockSkipsClosedOrders pins the order-status filter in the
// "committed" query. CancelOrder now closes its unserved lines too, so the DB
// test cannot see this line: the filter is what frees stock held by orders
// cancelled before that change, whose lines are still pending or cooking. Drop
// it and a dish stays sold out for as long as such a row exists.
func TestCommittedStockSkipsClosedOrders(t *testing.T) {
	source, err := os.ReadFile("menu_availability.go")
	if err != nil {
		t.Fatalf("read menu_availability.go: %v", err)
	}
	join := regexp.MustCompile(`JOIN orders o ON o\.id = oi\.order_id AND o\.deleted_at IS NULL AND o\.status NOT IN \('completed','cancelled'\)`)
	if !join.Match(source) {
		t.Fatal("the committed-stock query no longer skips completed and cancelled orders")
	}
	claim := regexp.MustCompile(`oi\.status IN \('pending','cooking'\)`)
	if !claim.Match(source) {
		t.Fatal("the committed-stock query no longer counts only pending and cooking lines")
	}
}
