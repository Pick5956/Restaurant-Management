package config

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"reflect"
	"testing"

	"Project-M/internal/entity"
)

func TestSchemaMigrationPlanIsOrderedAndMatchesCurrentVersion(t *testing.T) {
	plan := schemaMigrationPlan()
	if len(plan) == 0 {
		t.Fatal("schema migration plan is empty")
	}
	if err := validateMigrationPlan(plan); err != nil {
		t.Fatalf("validateMigrationPlan() error = %v", err)
	}
	if got := plan[len(plan)-1].Version; got != CurrentSchemaVersion {
		t.Fatalf("latest migration = %d, CurrentSchemaVersion = %d", got, CurrentSchemaVersion)
	}
}

func TestValidateMigrationPlanRejectsDuplicateOrOutOfOrderVersions(t *testing.T) {
	noop := func(*MigrationContext) error { return nil }
	tests := []struct {
		name string
		plan []SchemaMigration
	}{
		{
			name: "duplicate",
			plan: []SchemaMigration{
				{Version: 1, Name: "one", Up: noop},
				{Version: 1, Name: "duplicate", Up: noop},
			},
		},
		{
			name: "gap",
			plan: []SchemaMigration{
				{Version: 1, Name: "one", Up: noop},
				{Version: 3, Name: "three", Up: noop},
			},
		},
		{
			name: "missing function",
			plan: []SchemaMigration{
				{Version: 1, Name: "one"},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if err := validateMigrationPlan(test.plan); err == nil {
				t.Fatal("validateMigrationPlan() unexpectedly succeeded")
			}
		})
	}
}

func TestSchemaModelRegistryFingerprintMatchesVersion(t *testing.T) {
	// Add a new expected fingerprint only alongside a new numbered migration.
	// A mismatch at the same version means a model or GORM constraint changed
	// without a migration.
	expectedByVersion := map[int64]string{
		3: "93f62e8ae2c047002f2e9ce2aa18393e5fd69451c9f99cdebb897da0a27794d9",
		4: "54e77aad004fbfea627460ce1142c09f4135346a7bf045887d8f85f032b689d9",
		5: "e2eeb8569b40e91640b95e366422330bdbc8da7c0a779f319fd58a548dd993a0",
		6: "33ff3e4d49f8621dfb806c3cab572de8692e248f2dfe83be032fae0cb0da3835",
		7: "6ef6936c4f2e182a3e37a64d9addcfc9b4a80869cc546d324666041e826cc343",
		// Versions 8 and 9 are the AI migrations. They register their tables
		// inside the migration itself, so the frozen baseline registry — and
		// therefore its fingerprint — is unchanged from version 7.
		8:  "6ef6936c4f2e182a3e37a64d9addcfc9b4a80869cc546d324666041e826cc343",
		9:  "6ef6936c4f2e182a3e37a64d9addcfc9b4a80869cc546d324666041e826cc343",
		10: "6ef6936c4f2e182a3e37a64d9addcfc9b4a80869cc546d324666041e826cc343",
		11: "ff8fe0c5b93334a83a0d0595008a4dbab6c27986148edff3dfb6dd4445395b0f",
		// Version 12 (AI operating calendar) registers its table inside the
		// migration and touches no baseline model, so the frozen registry
		// fingerprint is unchanged from version 11.
		12: "ff8fe0c5b93334a83a0d0595008a4dbab6c27986148edff3dfb6dd4445395b0f",
		// Version 13 rebuilt idx_orders_restaurant_day_number_v2 as a partial unique
		// index, which changed the Order model's gorm index tag — so the registry
		// fingerprint advances here.
		13: "fdad3196f5a6414532f5d5aa0236e815d0ec8970e1c69412c0cb000797fa0235",
		// Version 14 reseeds the waiter role (data only). The menu availability read
		// model also added a computed gorm:"-" field to MenuItem (no DB change); the
		// fingerprint reflects the current models.
		14: "fdad3196f5a6414532f5d5aa0236e815d0ec8970e1c69412c0cb000797fa0235",
		// Version 15 adds Restaurant.AIActionsEnabled — the owner's toggle for the
		// assistant's write actions — so the registry fingerprint advances.
		15: "567155fe0788640f0e6c032c2a2ed8723e7adfe43eee6f782614711d43d650c4",
		// Version 16 adds the multi-item action plan tables (AIActionPlan +
		// AIActionPlanItem) inside the migration itself, following the same rule as
		// the earlier AI tables: the frozen baseline registry stays untouched, so
		// the fingerprint is unchanged from version 15.
		16: "567155fe0788640f0e6c032c2a2ed8723e7adfe43eee6f782614711d43d650c4",
		// Version 17 only widens a CHECK constraint on an AI-owned table, so the
		// frozen baseline registry is unchanged again.
		17: "567155fe0788640f0e6c032c2a2ed8723e7adfe43eee6f782614711d43d650c4",
		// Version 18 widens the same CHECK constraint again (menu availability),
		// still on an AI-owned table outside the frozen registry.
		18: "567155fe0788640f0e6c032c2a2ed8723e7adfe43eee6f782614711d43d650c4",
		// Version 19 widens the same CHECK once more (recording an expense).
		//
		// The hash then moved without the database moving: Ingredient gained
		// UnitFamily, a `gorm:"-"` field computed at read time to tell a client
		// which units it accepts. This fingerprint hashes every field, ignored
		// ones included, so a read-time field trips the gate even though it adds
		// no column and needs no migration. Reviewed and accepted on that basis -
		// CurrentSchemaVersion stays 19 because the schema itself is unchanged.
		19: "a2af463275584e4b9967d5cf758e96eb36661566ee360098420413465d5d1902",
		// Version 20 adds menu_option_ingredients: the ingredients one option
		// consumes on top of (or instead of) the dish recipe. A genuinely new
		// table in the baseline registry, so the fingerprint advances.
		20: "29c7a5867b20aedf28b9f9f2431fd3f1d6bb2ade636f827885728f8602da79f6",
		// Versions 21 (latency_ms on AI conversation turns) and 22 (the owner's
		// AI preferences on Restaurant) arrived together in one merge, renumbered
		// from 20/21 on the assistant branch; the registry was never frozen
		// between them, so both carry the merged registry's hash.
		21: "ef33ae90b3371c6091807765f0c1e1bf9db93df2790fb7ca0b58e373ad2abd80",
		22: "ef33ae90b3371c6091807765f0c1e1bf9db93df2790fb7ca0b58e373ad2abd80",
		// Version 23 adds title, trash and per-turn display data to the AI
		// conversation tables, which live outside the frozen registry (created
		// by migration 8's own AutoMigrate), so the fingerprint is unchanged.
		23: "ef33ae90b3371c6091807765f0c1e1bf9db93df2790fb7ca0b58e373ad2abd80",
		// Version 24 widens the action-type CHECK once more (creating a menu
		// item), on the plan table that migration 16 owns outside the frozen
		// registry, so the fingerprint is unchanged.
		24: "ef33ae90b3371c6091807765f0c1e1bf9db93df2790fb7ca0b58e373ad2abd80",
		// Version 25 adds reserved_for to Reservation, which IS in the frozen
		// registry, so the fingerprint advances with it. The hash then moved a
		// second time for RestaurantTable's UpcomingReservationAt/Name: those are
		// `gorm:"-"`, so they add no column and need no migration, but this
		// fingerprint hashes every field including ignored ones — the same
		// read-time-field case reviewed at version 19. Reviewed and accepted on
		// that basis: no schema version was spent on them, because nothing in
		// the database changed for them.
		25: "58517db8965b8fd1d0b59b2104626da699d9f7a7dd25ac39cf921239e937ae1c",
		// Version 26 adds guest_count to Reservation, again inside the frozen
		// registry, so the fingerprint advances with the column.
		26: "381840175afa65b561866fd5d184fea3913b6fa794d6380b282dfbf03c70eee9",
		// Version 27 adds no column. It puts a partial unique index across
		// Reservation's (restaurant_id, table_id, reserved_for) so one table
		// cannot hold two active bookings for the same instant, and the index
		// tags live on fields in the frozen registry, so the fingerprint advances
		// even though the only DDL is CREATE UNIQUE INDEX plus its backfill.
		27: "359a653ff6994b5a81b9f8678f0d97a9114a4bcc57a254637a0952a38841fe63",
	}
	want, ok := expectedByVersion[CurrentSchemaVersion]
	if !ok {
		t.Fatalf(
			"schema version %d has no reviewed model fingerprint; add its migration and fingerprint together",
			CurrentSchemaVersion,
		)
	}
	if got := schemaModelRegistryFingerprint(SchemaModels()); got != want {
		t.Fatalf(
			"schema model registry changed without a reviewed migration: got %s, want %s for version %d",
			got,
			want,
			CurrentSchemaVersion,
		)
	}
}

func TestAIConversationMigrationIsAdditiveVersionEight(t *testing.T) {
	plan := schemaMigrationPlan()
	conversationMigration := plan[7]
	if conversationMigration.Version != 8 || conversationMigration.Name != "add_ai_conversation_state" {
		t.Fatalf("migration 8 = %d %q, want AI conversation migration", conversationMigration.Version, conversationMigration.Name)
	}
	if conversationMigration.Up == nil {
		t.Fatal("AI conversation migration has no up function")
	}

	// The migration-1 clean-reset registry is frozen. New models belong only in
	// the numbered migration so disabling the feature does not change the
	// baseline or require destructive table removal.
	for _, model := range SchemaModels() {
		typeName := reflect.TypeOf(model).Elem().Name()
		if typeName == "AIConversation" || typeName == "AIConversationTurn" {
			t.Fatalf("%s must not be added to the frozen SchemaModels baseline", typeName)
		}
	}
}

func TestAIActionPreviewMigrationIsAdditiveVersionNine(t *testing.T) {
	plan := schemaMigrationPlan()
	actionPreviewMigration := plan[8]
	if actionPreviewMigration.Version != 9 || actionPreviewMigration.Name != "add_ai_action_previews" {
		t.Fatalf("migration 9 = %d %q, want AI action preview migration", actionPreviewMigration.Version, actionPreviewMigration.Name)
	}
	if actionPreviewMigration.Up == nil {
		t.Fatal("AI action preview migration has no up function")
	}

	// The migration-1 registry must stay frozen. Version 9 is additive and its
	// safe rollback is disabling the feature while retaining the table. A
	// version-8 application is not a valid rollback after this ledger advances.
	for _, model := range SchemaModels() {
		typeName := reflect.TypeOf(model).Elem().Name()
		if typeName == "AIActionPreview" {
			t.Fatal("AIActionPreview must not be added to the frozen SchemaModels baseline")
		}
	}
	wantForeignKeys := []string{"Restaurant", "Owner", "Conversation", "Turn", "TargetMenuItem"}
	if !reflect.DeepEqual(aiActionPreviewForeignKeys, wantForeignKeys) {
		t.Fatalf("AI action preview foreign keys = %#v, want %#v", aiActionPreviewForeignKeys, wantForeignKeys)
	}
}

func TestGranularPermissionDefaultsAreReseededInVersionTen(t *testing.T) {
	plan := schemaMigrationPlan()
	permissionMigration := plan[9]
	if permissionMigration.Version != 10 || permissionMigration.Name != "reseed_granular_role_permissions" {
		t.Fatalf("migration 10 = %d %q, want granular permission reseed", permissionMigration.Version, permissionMigration.Name)
	}
	if permissionMigration.Up == nil {
		t.Fatal("granular permission migration has no up function")
	}
}

func TestRoleDisplayNameOverrideMigrationIsAdditiveVersionEleven(t *testing.T) {
	plan := schemaMigrationPlan()
	// v11 is no longer the latest (v12 AI calendar follows), so index it directly.
	displayNameMigration := plan[10]
	if displayNameMigration.Version != 11 || displayNameMigration.Name != "add_restaurant_role_display_name_overrides" {
		t.Fatalf("migration 11 = %d %q, want scoped role display names", displayNameMigration.Version, displayNameMigration.Name)
	}
	if displayNameMigration.Up == nil {
		t.Fatal("role display-name override migration has no up function")
	}
	for _, model := range SchemaModels() {
		if typeName := reflect.TypeOf(model).Elem().Name(); typeName == "RestaurantRoleDisplayNameOverride" {
			t.Fatal("RestaurantRoleDisplayNameOverride must not be added to frozen SchemaModels")
		}
	}
	wantForeignKeys := []string{"Restaurant", "Role"}
	if !reflect.DeepEqual(roleDisplayNameOverrideForeignKeys, wantForeignKeys) {
		t.Fatalf("role display-name override foreign keys = %#v, want %#v", roleDisplayNameOverrideForeignKeys, wantForeignKeys)
	}
}

func TestAIOperatingCalendarMigrationIsAdditiveVersionTwelve(t *testing.T) {
	plan := schemaMigrationPlan()
	// v12 is no longer the latest (v13/v14 follow), so index it directly.
	calendarMigration := plan[11]
	if calendarMigration.Version != 12 || calendarMigration.Name != "add_ai_operating_calendar" {
		t.Fatalf("migration 12 = %d %q, want version 12 AI operating calendar migration", calendarMigration.Version, calendarMigration.Name)
	}
	if calendarMigration.Up == nil {
		t.Fatal("AI operating calendar migration has no up function")
	}
	// The migration-1 registry stays frozen. The calendar table is registered
	// only in the numbered migration, so disabling the forecast leaves it unused.
	for _, model := range SchemaModels() {
		if reflect.TypeOf(model).Elem().Name() == "AIOperatingCalendarRule" {
			t.Fatal("AIOperatingCalendarRule must not be added to the frozen SchemaModels baseline")
		}
	}
}

func TestAdditiveMigrationModelFingerprintsStayFrozen(t *testing.T) {
	tests := []struct {
		name   string
		models []any
		want   string
	}{
		{
			name:   "version 8 conversations",
			models: []any{&entity.AIConversation{}, &entity.AIConversationTurn{}},
			// refrozen at v20 (latency_ms on the turn) and again at v23: title,
			// title_by_owner and trashed_at on the conversation, display_json on
			// the turn — the chat list and the trash.
			want:   "2fa35e7062c9b82296f857dfb37e8edcdf3a1956efa7fb8b465e4535e607e63f",
		},
		{
			name:   "version 9 action previews",
			models: []any{&entity.AIActionPreview{}},
			want:   "0287437f4aef0d4042319d049ad4877cbee7ee29e0b6636a3ea2cc5a87b4df94",
		},
		{
			name:   "version 11 role display-name overrides",
			models: []any{&entity.RestaurantRoleDisplayNameOverride{}},
			want:   "2978cb8604d30e130a39ccbeec9f6bd5b5138c4cde27497a9ac4afd435107f56",
		},
	}
	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			got := schemaModelRegistryFingerprint(testCase.models)
			if got != testCase.want {
				t.Errorf("additive migration model changed without a new migration: got %s want %s", got, testCase.want)
			}
		})
	}
}

func schemaModelRegistryFingerprint(models []any) string {
	hash := sha256.New()
	for index, model := range models {
		modelType := reflect.TypeOf(model)
		for modelType.Kind() == reflect.Pointer {
			modelType = modelType.Elem()
		}
		_, _ = fmt.Fprintf(
			hash,
			"%d|%s.%s\n",
			index,
			modelType.PkgPath(),
			modelType.Name(),
		)
		for fieldIndex := 0; fieldIndex < modelType.NumField(); fieldIndex++ {
			field := modelType.Field(fieldIndex)
			_, _ = fmt.Fprintf(
				hash,
				"%s|%s|%t|%s\n",
				field.Name,
				field.Type.String(),
				field.Anonymous,
				field.Tag.Get("gorm"),
			)
		}
	}
	return hex.EncodeToString(hash.Sum(nil))
}
