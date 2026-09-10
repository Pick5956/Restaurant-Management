package config

import (
	"context"
	"errors"
	"fmt"
	"time"

	"Project-M/config/seed"
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

const (
	CurrentSchemaVersion int64 = 27
	migrationAdvisoryKey int64 = 0x524855424d494752
)

type MigrationContext struct {
	DB *gorm.DB
}

type SchemaMigration struct {
	Version int64
	Name    string
	Up      func(*MigrationContext) error
}

type schemaMigrationRecord struct {
	Version   int64     `gorm:"primaryKey;autoIncrement:false"`
	Name      string    `gorm:"size:160;not null;uniqueIndex"`
	AppliedAt time.Time `gorm:"not null"`
}

func (schemaMigrationRecord) TableName() string {
	return "schema_migrations"
}

func schemaMigrationPlan() []SchemaMigration {
	return []SchemaMigration{
		{
			Version: 1,
			Name:    "create_current_schema",
			Up: func(ctx *MigrationContext) error {
				// SchemaModels is the clean-reset baseline for the first
				// versioned release. Once that baseline ships, it must be
				// frozen and later schema changes must use a new migration.
				if err := ctx.DB.AutoMigrate(SchemaModels()...); err != nil {
					return fmt.Errorf("auto migrate current schema: %w", err)
				}
				return nil
			},
		},
		{
			Version: 2,
			Name:    "seed_system_roles",
			Up: func(ctx *MigrationContext) error {
				if err := seed.SeedRoles(ctx.DB); err != nil {
					return fmt.Errorf("seed system roles: %w", err)
				}
				return nil
			},
		},
		{
			Version: 3,
			Name:    "harden_operational_schema",
			Up: func(ctx *MigrationContext) error {
				models := []any{
					&entity.User{},
					&entity.RestaurantRolePermissionOverride{},
					&entity.RestaurantMember{},
					&entity.Invitation{},
					&entity.IngredientCategory{},
					&entity.Ingredient{},
					&entity.IngredientTransaction{},
					&entity.Category{},
					&entity.MenuItem{},
					&entity.MenuItemCategory{},
					&entity.MenuItemIngredient{},
					&entity.MenuOptionGroup{},
					&entity.MenuOption{},
					&entity.TableZone{},
					&entity.TableTag{},
					&entity.RestaurantTable{},
					&entity.Order{},
					&entity.OrderItem{},
					&entity.OrderPayment{},
					&entity.OrderItemRecipeSnapshot{},
					&entity.OrderInventoryDeduction{},
					&entity.CustomerOrderSubmission{},
				}
				if err := ctx.DB.AutoMigrate(models...); err != nil {
					return fmt.Errorf("migrate hardened operational models: %w", err)
				}
				if err := createOrderSearchIndexes(ctx.DB); err != nil {
					return err
				}
				return nil
			},
		},
		{
			Version: 4,
			Name:    "add_restaurant_order_geofence",
			Up: func(ctx *MigrationContext) error {
				// Adds latitude/longitude/order_radius_meters used to keep QR
				// table orders from being sent outside the restaurant.
				if err := ctx.DB.AutoMigrate(&entity.Restaurant{}); err != nil {
					return fmt.Errorf("migrate restaurant order geofence: %w", err)
				}
				return nil
			},
		},
		{
			Version: 5,
			Name:    "add_reservations",
			Up: func(ctx *MigrationContext) error {
				// Reservation history: track table bookings and their outcome
				// (seated / cancelled / no-show) separately from the order archive.
				if err := ctx.DB.AutoMigrate(&entity.Reservation{}); err != nil {
					return fmt.Errorf("migrate reservations: %w", err)
				}
				return nil
			},
		},
		{
			// Versions 6 and 7 stay as main numbered them. Every database that
			// already followed main has these recorded, and the schema ledger
			// compares version *and* name, so renumbering them would lock those
			// databases out. The AI migrations that collided move to 8 and 9.
			Version: 6,
			Name:    "add_expenses",
			Up: func(ctx *MigrationContext) error {
				// Cash actually paid out (supplies, wages, rent). Kept separate
				// from order_inventory_deductions, which is the recipe cost of
				// food already sold.
				if err := ctx.DB.AutoMigrate(&entity.Expense{}); err != nil {
					return fmt.Errorf("migrate expenses: %w", err)
				}
				// Re-seed so the new manage_expenses permission reaches the
				// existing system roles (SeedRoles updates permissions on
				// conflict rather than skipping).
				if err := seed.SeedRoles(ctx.DB); err != nil {
					return fmt.Errorf("reseed roles for expenses: %w", err)
				}
				return nil
			},
		},
		{
			Version: 7,
			Name:    "link_restock_spend_to_expenses",
			Up: func(ctx *MigrationContext) error {
				// Restocks can now carry what they cost, and write the matching
				// ledger row themselves instead of relying on double entry.
				if err := ctx.DB.AutoMigrate(&entity.IngredientTransaction{}, &entity.Expense{}); err != nil {
					return fmt.Errorf("migrate restock spend: %w", err)
				}
				return nil
			},
		},
		{
			Version: 8,
			Name:    "add_ai_conversation_state",
			Up: func(ctx *MigrationContext) error {
				// Additive-only persistence for compact AI conversation state and
				// bounded turn history. Feature rollback leaves these unused tables in
				// place instead of destructively dropping user history. An older
				// binary is still rejected by the existing schema-ledger policy.
				models := []any{
					&entity.AIConversation{},
					&entity.AIConversationTurn{},
				}
				if err := ctx.DB.AutoMigrate(models...); err != nil {
					return fmt.Errorf("migrate AI conversation state: %w", err)
				}
				return nil
			},
		},
		{
			Version: 9,
			Name:    "add_ai_action_previews",
			Up: func(ctx *MigrationContext) error {
				// Additive-only persistence for short-lived, owner-confirmed AI
				// actions. Disabling AI actions leaves this table unused and is the
				// supported application rollback. Once version 9 is recorded, the
				// schema ledger intentionally rejects an older binary.
				if err := migrateAIActionPreviews(ctx.DB); err != nil {
					return fmt.Errorf("migrate AI action previews: %w", err)
				}
				return nil
			},
		},
		{
			Version: 10,
			Name:    "reseed_granular_role_permissions",
			Up: func(ctx *MigrationContext) error {
				// No schema changes: refresh only the global system-role defaults.
				// Existing tenant overrides remain intact and use runtime legacy
				// compatibility until an administrator saves the granular model.
				if err := seed.SeedRoles(ctx.DB); err != nil {
					return fmt.Errorf("reseed granular role permissions: %w", err)
				}
				return nil
			},
		},
		{
			Version: 11,
			Name:    "add_restaurant_role_display_name_overrides",
			Up: func(ctx *MigrationContext) error {
				if err := migrateRoleDisplayNameOverrides(ctx.DB); err != nil {
					return fmt.Errorf("migrate restaurant role display-name overrides: %w", err)
				}
				return nil
			},
		},
		{
			Version: 12,
			Name:    "add_ai_operating_calendar",
			Up: func(ctx *MigrationContext) error {
				// Additive-only: the AI feature's own operating calendar (closed
				// weekdays + one-off closures/holidays) used by the sales forecast.
				// It links by restaurant_id and never touches the shared restaurant
				// table, so disabling the forecast leaves this table unused as the
				// rollback. Numbered after main's 10 and 11 — the same pattern as the
				// earlier AI migrations that moved to 8 and 9.
				if err := ctx.DB.AutoMigrate(&entity.AIOperatingCalendarRule{}); err != nil {
					return fmt.Errorf("migrate AI operating calendar: %w", err)
				}
				return nil
			},
		},
		{
			Version: 13,
			Name:    "partial_unique_order_day_number",
			Up: func(ctx *MigrationContext) error {
				// Closing an empty table soft-deletes its order (deleted_at set) but
				// leaves the row in place. The daily order-number sequence counts only
				// live rows, so reopening the same table that day regenerates the same
				// number — which collided with the soft-deleted ghost because
				// idx_orders_restaurant_day_number_v2 was a plain (non-partial) unique
				// index. Rebuild it as a partial unique index scoped to live rows, the
				// same pattern idx_orders_one_active_table already uses, so a reused
				// number can coexist with the soft-deleted order it replaces.
				statements := []string{
					"DROP INDEX IF EXISTS idx_orders_restaurant_day_number_v2",
					"CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_restaurant_day_number_v2 ON orders (restaurant_id, order_date, order_number) WHERE deleted_at IS NULL",
				}
				for _, statement := range statements {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("rebuild partial order day-number index: %w", err)
					}
				}
				return nil
			},
		},
		{
			Version: 14,
			Name:    "waiter_default_drop_dashboard_tables",
			Up: func(ctx *MigrationContext) error {
				// The waiter default no longer grants view_dashboard or view_tables.
				// Order-taking is unaffected: ListTables/UpdateTableStatus also accept
				// take_order, and waiters land on /pos/tables. Update the global system
				// waiter role in place; per-member permission overrides are untouched.
				result := ctx.DB.Model(&entity.Role{}).
					Where("name = ? AND restaurant_id IS NULL AND is_system = ?", "waiter", true).
					Update("permissions", `["take_order","take_payment","view_orders"]`)
				if result.Error != nil {
					return fmt.Errorf("update waiter default permissions: %w", result.Error)
				}
				return nil
			},
		},
		{
			Version: 15,
			Name:    "restaurant_ai_actions_enabled",
			Up: func(ctx *MigrationContext) error {
				// Additive-only: a per-restaurant opt-in that lets the owner turn the
				// assistant's ability to make (previewed, confirmed) changes on or off
				// from the AI settings, replacing the env allowlist. Defaults to false,
				// so nothing changes for an existing restaurant until the owner opts in.
				if err := ctx.DB.AutoMigrate(&entity.Restaurant{}); err != nil {
					return fmt.Errorf("migrate restaurant AI actions flag: %w", err)
				}
				return nil
			},
		},
		{
			Version: 16,
			Name:    "ai_action_plans",
			Up: func(ctx *MigrationContext) error {
				// Additive-only: the multi-item action boundary (a plan the owner
				// confirms once, holding N changes of allowed types). The existing
				// single-menu preview table is untouched, so rolling this back just
				// leaves two unused tables.
				if err := ctx.DB.AutoMigrate(&entity.AIActionPlan{}, &entity.AIActionPlanItem{}); err != nil {
					return fmt.Errorf("migrate AI action plans: %w", err)
				}
				return nil
			},
		},
		{
			Version: 17,
			Name:    "ai_action_plan_inventory_types",
			Up: func(ctx *MigrationContext) error {
				// Widens the reviewed action allowlist to the rest of the inventory
				// set (min stock, cost, adding an ingredient). The constraint is
				// dropped and recreated because a CHECK cannot be altered in place;
				// rolling back means narrowing it again, not dropping data.
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items DROP CONSTRAINT IF EXISTS ai_action_plan_items_allowed_type`,
				).Error; err != nil {
					return fmt.Errorf("drop AI action type constraint: %w", err)
				}
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items ADD CONSTRAINT ai_action_plan_items_allowed_type
						CHECK (action_type IN ('adjust_ingredient_stock','set_ingredient_min_stock','set_ingredient_cost','create_ingredient'))`,
				).Error; err != nil {
					return fmt.Errorf("recreate AI action type constraint: %w", err)
				}
				return nil
			},
		},
		{
			Version: 18,
			Name:    "ai_action_plan_menu_availability_type",
			Up: func(ctx *MigrationContext) error {
				// Adds opening and closing a menu to the reviewed action allowlist,
				// so the owner's plain-language menu commands travel the same
				// confirmed path as the inventory ones instead of the separate,
				// keyword-matched boundary they used to have. Additive: the
				// constraint only widens, so rolling back narrows it again without
				// touching a single row.
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items DROP CONSTRAINT IF EXISTS ai_action_plan_items_allowed_type`,
				).Error; err != nil {
					return fmt.Errorf("drop AI action type constraint: %w", err)
				}
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items ADD CONSTRAINT ai_action_plan_items_allowed_type
						CHECK (action_type IN ('adjust_ingredient_stock','set_ingredient_min_stock','set_ingredient_cost','create_ingredient','set_menu_availability'))`,
				).Error; err != nil {
					return fmt.Errorf("recreate AI action type constraint: %w", err)
				}
				return nil
			},
		},
		{
			Version: 19,
			Name:    "ai_action_plan_expense_and_menu_price_types",
			Up: func(ctx *MigrationContext) error {
				// Adds recording an expense and changing a menu price to the reviewed
				// action allowlist. Same additive shape as 17 and 18: the constraint
				// only widens. Both arrive in one migration because they were built
				// together — a second numbered step for the same CHECK would only add
				// a version every deployed database has to walk through.
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items DROP CONSTRAINT IF EXISTS ai_action_plan_items_allowed_type`,
				).Error; err != nil {
					return fmt.Errorf("drop AI action type constraint: %w", err)
				}
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items ADD CONSTRAINT ai_action_plan_items_allowed_type
						CHECK (action_type IN ('adjust_ingredient_stock','set_ingredient_min_stock','set_ingredient_cost','create_ingredient','set_menu_availability','create_expense','set_menu_price'))`,
				).Error; err != nil {
					return fmt.Errorf("recreate AI action type constraint: %w", err)
				}
				return nil
			},
		},
		{
			Version: 20,
			Name:    "menu_option_ingredients",
			Up: func(ctx *MigrationContext) error {
				// Lets one option carry its own ingredient use, so "เพิ่มกุ้ง 2 ตัว"
				// deducts two more shrimp instead of only charging for them.
				// Additive: a new table nothing reads yet, so rolling back leaves
				// an unused table and every existing recipe deduction untouched.
				if err := ctx.DB.AutoMigrate(&entity.MenuOptionIngredient{}); err != nil {
					return fmt.Errorf("migrate menu option ingredients: %w", err)
				}
				return nil
			},
		},
		// 21 and 22 were numbered 20 and 21 on the assistant branch while main
		// took 20 for menu_option_ingredients. Main's number stands — the public
		// deploy had already run it — so these moved up. Both are IF NOT EXISTS,
		// so a database that ran them under the old numbers takes them again
		// without complaint.
		{
			Version: 21,
			Name:    "ai_conversation_turn_latency",
			Up: func(ctx *MigrationContext) error {
				// Additive: one integer column, defaulting to 0 for every turn
				// already stored, so nothing that reads turns has to change.
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_conversation_turns ADD COLUMN IF NOT EXISTS latency_ms BIGINT NOT NULL DEFAULT 0`,
				).Error; err != nil {
					return fmt.Errorf("add AI conversation turn latency: %w", err)
				}
				return nil
			},
		},
		{
			Version: 22,
			Name:    "restaurant_ai_preferences",
			Up: func(ctx *MigrationContext) error {
				// The AI settings screen grew sections: which of the seven actions
				// the assistant may prepare, which bell insights to show, and what
				// it calls the owner. Three additive columns on the restaurant row.
				// The two JSONB columns default to NULL on purpose — NULL is "the
				// owner has not chosen", which the service reads as "everything
				// on", so a shop that already switched actions on keeps exactly the
				// behaviour it had.
				for _, statement := range []string{
					`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_action_types JSONB`,
					`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_insight_kinds JSONB`,
					`ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS ai_owner_title VARCHAR(40) NOT NULL DEFAULT ''`,
				} {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("add restaurant AI preferences: %w", err)
					}
				}
				return nil
			},
		},
		{
			Version: 23,
			Name:    "ai_conversation_threads",
			Up: func(ctx *MigrationContext) error {
				// Many chats per owner, like a chat app: each conversation gets a
				// title and a trash timestamp, and each turn keeps what the screen
				// needs to show the answer again (chart, forecast, tools). All
				// additive. Existing chats are titled from their first stored
				// question so the list is never blank on the day this ships.
				for _, statement := range []string{
					`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS title VARCHAR(80) NOT NULL DEFAULT ''`,
					`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS title_by_owner BOOLEAN NOT NULL DEFAULT false`,
					`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS trashed_at TIMESTAMPTZ NULL`,
					`CREATE INDEX IF NOT EXISTS idx_ai_conversations_trash ON ai_conversations (restaurant_id, owner_user_id, trashed_at)`,
					`ALTER TABLE ai_conversation_turns ADD COLUMN IF NOT EXISTS display_json JSONB NOT NULL DEFAULT '{}'`,
					`UPDATE ai_conversations c SET title = left(regexp_replace(t.question, '\s+', ' ', 'g'), 40)
					 FROM ai_conversation_turns t
					 WHERE t.conversation_id = c.id AND c.title = ''
					   AND t.sequence = (SELECT min(m.sequence) FROM ai_conversation_turns m WHERE m.conversation_id = c.id)`,
				} {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("add AI conversation threads: %w", err)
					}
				}
				return nil
			},
		},
		{
			Version: 24,
			Name:    "ai_action_create_menu_item",
			Up: func(ctx *MigrationContext) error {
				// Adds creating a menu item to the reviewed action allowlist. Same
				// additive shape as 17, 18 and 19: the constraint only widens.
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items DROP CONSTRAINT IF EXISTS ai_action_plan_items_allowed_type`,
				).Error; err != nil {
					return fmt.Errorf("drop AI action type constraint: %w", err)
				}
				if err := ctx.DB.Exec(
					`ALTER TABLE ai_action_plan_items ADD CONSTRAINT ai_action_plan_items_allowed_type
						CHECK (action_type IN ('adjust_ingredient_stock','set_ingredient_min_stock','set_ingredient_cost','create_ingredient','set_menu_availability','create_expense','set_menu_price','create_menu_item'))`,
				).Error; err != nil {
					return fmt.Errorf("recreate AI action type constraint: %w", err)
				}
				return nil
			},
		},
		{
			Version: 25,
			Name:    "reservation_reserved_for",
			Up: func(ctx *MigrationContext) error {
				// Additive and nullable on purpose: every reservation written
				// before this migration was a hold-the-table-now booking, and a
				// null `reserved_for` is exactly how that is spelled afterwards.
				// Nothing has to be backfilled and no existing row changes meaning.
				for _, statement := range []string{
					`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reserved_for TIMESTAMPTZ`,
					`CREATE INDEX IF NOT EXISTS idx_reservations_reserved_for ON reservations (restaurant_id, reserved_for)`,
				} {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("add reservation booking time: %w", err)
					}
				}
				return nil
			},
		},
		{
			Version: 26,
			Name:    "reservation_guest_count",
			Up: func(ctx *MigrationContext) error {
				// NOT NULL with a default so existing rows land on 1 rather than
				// null: a booking made before this column existed had a party
				// size, it just was not written down, and 1 is the honest floor.
				// The CHECK is added after the backfill for the same reason.
				for _, statement := range []string{
					`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_count BIGINT NOT NULL DEFAULT 1`,
					`UPDATE reservations SET guest_count = 1 WHERE guest_count IS NULL OR guest_count < 1`,
					`ALTER TABLE reservations DROP CONSTRAINT IF EXISTS chk_reservations_guest_count_positive`,
					`ALTER TABLE reservations ADD CONSTRAINT chk_reservations_guest_count_positive CHECK (guest_count > 0)`,
				} {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("add reservation guest count: %w", err)
					}
				}
				return nil
			},
		},
		{
			Version: 27,
			Name:    "reservation_one_active_slot",
			Up: func(ctx *MigrationContext) error {
				// The backfill is not optional. Until now nothing stopped the same
				// booking being filed twice, so live databases already hold
				// duplicates — and CREATE UNIQUE INDEX on those fails, which would
				// take the backend down on boot rather than at deploy time.
				//
				// The oldest row of each group survives because it is the one the
				// staff saw succeed; the later copies are the accidental repeats.
				// They are cancelled rather than deleted so the history screen can
				// still show what happened, which is the whole point of this table.
				//
				// Holds are excluded throughout: `reserved_for IS NULL` rows are
				// the table's current hold, at most one of which is meaningful, and
				// reconcileActiveReservationsForUpdate already owns that case.
				for _, statement := range []string{
					`UPDATE reservations AS duplicate
					    SET status = 'cancelled', resolved_at = NOW(), updated_at = NOW()
					  WHERE duplicate.status = 'active'
					    AND duplicate.reserved_for IS NOT NULL
					    AND duplicate.deleted_at IS NULL
					    AND EXISTS (
					        SELECT 1 FROM reservations AS kept
					         WHERE kept.restaurant_id = duplicate.restaurant_id
					           AND kept.table_id = duplicate.table_id
					           AND kept.reserved_for = duplicate.reserved_for
					           AND kept.status = 'active'
					           AND kept.deleted_at IS NULL
					           AND kept.id < duplicate.id
					    )`,
					`CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_one_active_slot
					     ON reservations (restaurant_id, table_id, reserved_for)
					  WHERE reserved_for IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
				} {
					if err := ctx.DB.Exec(statement).Error; err != nil {
						return fmt.Errorf("enforce one active reservation per slot: %w", err)
					}
				}
				return nil
			},
		},
	}
}

var aiActionPreviewForeignKeys = []string{"Restaurant", "Owner", "Conversation", "Turn", "TargetMenuItem"}

var roleDisplayNameOverrideForeignKeys = []string{"Restaurant", "Role"}

func migrateRoleDisplayNameOverrides(database *gorm.DB) error {
	// Keep migration 11 additive: create only the new override table, then add
	// its reviewed links to the already-migrated restaurant and role tables.
	migrationDB := database.Session(&gorm.Session{NewDB: true})
	configCopy := *migrationDB.Config
	configCopy.IgnoreRelationshipsWhenMigrating = true
	migrationDB.Config = &configCopy
	if err := migrationDB.AutoMigrate(&entity.RestaurantRoleDisplayNameOverride{}); err != nil {
		return err
	}
	for _, relationship := range roleDisplayNameOverrideForeignKeys {
		if database.Migrator().HasConstraint(&entity.RestaurantRoleDisplayNameOverride{}, relationship) {
			continue
		}
		if err := database.Migrator().CreateConstraint(&entity.RestaurantRoleDisplayNameOverride{}, relationship); err != nil {
			return fmt.Errorf("create role display-name override %s constraint: %w", relationship, err)
		}
	}
	return nil
}

func migrateAIActionPreviews(database *gorm.DB) error {
	// AutoMigrate normally walks relationship dependencies and can migrate the
	// referenced restaurant, user, conversation, turn, and menu tables too. Keep
	// version 7 truly additive by creating/updating only the preview table, then
	// add its reviewed foreign keys explicitly.
	migrationDB := database.Session(&gorm.Session{NewDB: true})
	configCopy := *migrationDB.Config
	configCopy.IgnoreRelationshipsWhenMigrating = true
	migrationDB.Config = &configCopy
	if err := migrationDB.AutoMigrate(&entity.AIActionPreview{}); err != nil {
		return err
	}
	for _, relationship := range aiActionPreviewForeignKeys {
		if database.Migrator().HasConstraint(&entity.AIActionPreview{}, relationship) {
			continue
		}
		if err := database.Migrator().CreateConstraint(&entity.AIActionPreview{}, relationship); err != nil {
			return fmt.Errorf("create AI action preview %s constraint: %w", relationship, err)
		}
	}
	return nil
}

func createOrderSearchIndexes(database *gorm.DB) error {
	statements := []string{
		"CREATE EXTENSION IF NOT EXISTS pg_trgm",
		"CREATE INDEX IF NOT EXISTS idx_orders_number_trgm ON orders USING gin (lower(order_number) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm ON orders USING gin (lower(COALESCE(customer_name, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm ON orders USING gin (lower(COALESCE(customer_phone, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_restaurant_tables_number_trgm ON restaurant_tables USING gin (lower(COALESCE(table_number, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_restaurant_tables_label_trgm ON restaurant_tables USING gin (lower(COALESCE(display_label, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_restaurant_tables_zone_trgm ON restaurant_tables USING gin (lower(COALESCE(zone, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
		"CREATE INDEX IF NOT EXISTS idx_table_zones_name_trgm ON table_zones USING gin (lower(COALESCE(name, '')) gin_trgm_ops) WHERE deleted_at IS NULL",
	}
	for _, statement := range statements {
		if err := database.Exec(statement).Error; err != nil {
			return fmt.Errorf("create order search index: %w", err)
		}
	}
	return nil
}

func validateMigrationPlan(plan []SchemaMigration) error {
	if len(plan) == 0 {
		return errors.New("migration plan is empty")
	}
	for index, migration := range plan {
		expectedVersion := int64(index + 1)
		if migration.Version != expectedVersion {
			return fmt.Errorf("migration version %d must be %d", migration.Version, expectedVersion)
		}
		if migration.Name == "" {
			return fmt.Errorf("migration %d has no name", migration.Version)
		}
		if migration.Up == nil {
			return fmt.Errorf("migration %d has no up function", migration.Version)
		}
	}
	return nil
}

func RunMigrations(database *gorm.DB) error {
	if database == nil {
		return errors.New("database is not connected")
	}
	plan := schemaMigrationPlan()
	if err := validateMigrationPlan(plan); err != nil {
		return err
	}
	if plan[len(plan)-1].Version != CurrentSchemaVersion {
		return fmt.Errorf(
			"migration plan ends at version %d, expected %d",
			plan[len(plan)-1].Version,
			CurrentSchemaVersion,
		)
	}

	// The transaction-level lock is safe through PgBouncer transaction pooling:
	// PgBouncer pins one PostgreSQL connection for this entire transaction and
	// PostgreSQL releases the lock automatically on commit or rollback.
	return database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", migrationAdvisoryKey).Error; err != nil {
			return fmt.Errorf("acquire migration advisory lock: %w", err)
		}
		if err := tx.AutoMigrate(&schemaMigrationRecord{}); err != nil {
			return fmt.Errorf("create schema migration ledger: %w", err)
		}

		var applied []schemaMigrationRecord
		if err := tx.Order("version asc").Find(&applied).Error; err != nil {
			return fmt.Errorf("read applied migrations: %w", err)
		}
		appliedByVersion := make(map[int64]schemaMigrationRecord, len(applied))
		for _, record := range applied {
			if record.Version > CurrentSchemaVersion {
				return fmt.Errorf(
					"database schema version %d is newer than supported version %d",
					record.Version,
					CurrentSchemaVersion,
				)
			}
			appliedByVersion[record.Version] = record
		}

		for _, migration := range plan {
			if record, ok := appliedByVersion[migration.Version]; ok {
				if record.Name != migration.Name {
					return fmt.Errorf(
						"migration %d name changed from %q to %q",
						migration.Version,
						record.Name,
						migration.Name,
					)
				}
				continue
			}

			if err := migration.Up(&MigrationContext{DB: tx}); err != nil {
				return fmt.Errorf("apply migration %d (%s): %w", migration.Version, migration.Name, err)
			}
			record := schemaMigrationRecord{
				Version:   migration.Version,
				Name:      migration.Name,
				AppliedAt: time.Now().UTC(),
			}
			if err := tx.Create(&record).Error; err != nil {
				return fmt.Errorf("record migration %d: %w", migration.Version, err)
			}
		}
		return nil
	})
}

func EnsureSchemaCurrent(database *gorm.DB) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return ensureSchemaCurrent(ctx, database)
}

func ensureSchemaCurrent(ctx context.Context, database *gorm.DB) error {
	if database == nil {
		return errors.New("database is not connected")
	}
	plan := schemaMigrationPlan()
	if err := validateMigrationPlan(plan); err != nil {
		return err
	}
	if plan[len(plan)-1].Version != CurrentSchemaVersion {
		return fmt.Errorf(
			"migration plan ends at version %d, expected %d",
			plan[len(plan)-1].Version,
			CurrentSchemaVersion,
		)
	}

	database = database.WithContext(ctx)
	var ledgerExists bool
	if err := database.Raw(
		"SELECT to_regclass('public.schema_migrations') IS NOT NULL",
	).Scan(&ledgerExists).Error; err != nil {
		return fmt.Errorf("check database schema ledger: %w", err)
	}
	if !ledgerExists {
		return errors.New("database schema is not initialized; run the migration command")
	}

	var applied []schemaMigrationRecord
	if err := database.Order("version asc").Find(&applied).Error; err != nil {
		return fmt.Errorf("read database schema migrations: %w", err)
	}
	if len(applied) != len(plan) {
		return fmt.Errorf(
			"database has %d applied schema migrations; application requires %d",
			len(applied),
			len(plan),
		)
	}
	for index, migration := range plan {
		record := applied[index]
		if record.Version != migration.Version || record.Name != migration.Name {
			return fmt.Errorf(
				"database migration ledger mismatch at version %d; run the migration command",
				migration.Version,
			)
		}
	}
	return nil
}

func CheckDatabaseReadiness(ctx context.Context) error {
	if err := PingDatabase(ctx); err != nil {
		return err
	}
	return ensureSchemaCurrent(ctx, DB())
}
