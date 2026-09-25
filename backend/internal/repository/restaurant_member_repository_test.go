package repository

import (
	"reflect"
	"testing"
)

// TestMembershipsAreOnlyDeletedWithTheirRestaurant: a restaurant and its
// memberships are deleted in one transaction (DeleteWithMemberships). The
// member repository used to offer a delete of its own, and a restaurant delete
// built from it and a separate restaurant delete could fail between the two
// writes, leaving a live restaurant nobody - the owner included - could open.
// It had no caller left; this keeps it from coming back.
func TestMembershipsAreOnlyDeletedWithTheirRestaurant(t *testing.T) {
	if _, ok := reflect.TypeOf(&RestaurantMemberRepository{}).MethodByName("DeleteByRestaurant"); ok {
		t.Fatal("RestaurantMemberRepository.DeleteByRestaurant deletes memberships outside the restaurant delete; use RestaurantRepository.DeleteWithMemberships")
	}
	if _, ok := reflect.TypeOf(&RestaurantRepository{}).MethodByName("DeleteWithMemberships"); !ok {
		t.Fatal("RestaurantRepository.DeleteWithMemberships is the one way to delete a restaurant's memberships")
	}
}
