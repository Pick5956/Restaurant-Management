package controller

import "testing"

// Only an explicit ?scope=all widens the list; anything else - including no
// scope, which the Expo app sends - keeps the open-invitations list it had.
func TestInvitationListIncludesClosedOnlyForScopeAll(t *testing.T) {
	for scope, want := range map[string]bool{"all": true, "": false, "pending": false, "ALL": false} {
		if got := invitationListIncludesClosed(scope); got != want {
			t.Fatalf("scope %q: got %v, want %v", scope, got, want)
		}
	}
}
