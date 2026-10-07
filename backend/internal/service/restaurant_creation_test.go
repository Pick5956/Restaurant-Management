package service

import (
	"errors"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

type recordingRestaurantSetup struct {
	transactionCalls          int
	nextID                    uint
	restaurants               int
	members                   int
	menuCategories            map[string]struct{}
	ingredientCategories      map[string]struct{}
	menuItems                 int
	menuItemCategories        int
	menuOptionGroups          int
	menuOptions               int
	menuIngredients           int
	optionIngredients         []entity.MenuOptionIngredient
	ingredients               int
	tableZones                int
	tables                    int
	createdTables             []entity.RestaurantTable
	failAfterRestaurantCreate bool
}

func newRecordingRestaurantSetup() *recordingRestaurantSetup {
	return &recordingRestaurantSetup{
		nextID:               1,
		menuCategories:       map[string]struct{}{},
		ingredientCategories: map[string]struct{}{},
	}
}

func (f *recordingRestaurantSetup) Transaction(fn func(repository.RestaurantSetupWriter) error) error {
	f.transactionCalls++
	return fn(f)
}

func (f *recordingRestaurantSetup) assignID(modelID *uint) {
	*modelID = f.nextID
	f.nextID++
}

func (f *recordingRestaurantSetup) CreateRestaurant(value *entity.Restaurant) error {
	f.restaurants++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMember(value *entity.RestaurantMember) error {
	if f.failAfterRestaurantCreate {
		return errors.New("forced member failure")
	}
	f.members++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateCategory(value *entity.Category) error {
	if _, exists := f.menuCategories[value.Name]; exists {
		return errors.New("duplicate menu category")
	}
	f.menuCategories[value.Name] = struct{}{}
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuItem(value *entity.MenuItem) error {
	f.menuItems++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuItemCategory(value *entity.MenuItemCategory) error {
	f.menuItemCategories++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuOptionGroup(value *entity.MenuOptionGroup) error {
	f.menuOptionGroups++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuOption(value *entity.MenuOption) error {
	f.menuOptions++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuOptionIngredient(value *entity.MenuOptionIngredient) error {
	f.optionIngredients = append(f.optionIngredients, *value)
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateTableZone(value *entity.TableZone) error {
	f.tableZones++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateTable(value *entity.RestaurantTable) error {
	f.tables++
	f.assignID(&value.ID)
	f.createdTables = append(f.createdTables, *value)
	return nil
}

func (f *recordingRestaurantSetup) CreateIngredientCategory(value *entity.IngredientCategory) error {
	if _, exists := f.ingredientCategories[value.Name]; exists {
		return errors.New("duplicate ingredient category")
	}
	f.ingredientCategories[value.Name] = struct{}{}
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateIngredient(value *entity.Ingredient) error {
	f.ingredients++
	f.assignID(&value.ID)
	return nil
}

func (f *recordingRestaurantSetup) CreateMenuItemIngredient(value *entity.MenuItemIngredient) error {
	f.menuIngredients++
	f.assignID(&value.ID)
	return nil
}

func TestCreateRestaurantWithStarterDataUsesOneAtomicSeedPath(t *testing.T) {
	setup := newRecordingRestaurantSetup()
	fields := restaurantFields{
		Name:           "Test Restaurant",
		BranchName:     "Main",
		RestaurantType: "restaurant",
		OpenTime:       "09:00",
		CloseTime:      "22:00",
		TableCount:     6,
	}

	restaurant, member, err := createRestaurantWithStarterData(setup, 11, 22, fields, true)
	if err != nil {
		t.Fatalf("createRestaurantWithStarterData() error = %v", err)
	}
	if setup.transactionCalls != 1 {
		t.Fatalf("transaction calls = %d, want 1", setup.transactionCalls)
	}
	if setup.restaurants != 1 || setup.members != 1 {
		t.Fatalf("restaurant/member creates = %d/%d, want 1/1", setup.restaurants, setup.members)
	}

	profile := starterProfileFor(fields.RestaurantType)
	if len(setup.menuCategories) != len(profile.Categories) {
		t.Fatalf("menu categories = %d, want %d", len(setup.menuCategories), len(profile.Categories))
	}
	if len(setup.ingredientCategories) != len(profile.IngredientCategories) {
		t.Fatalf("ingredient categories = %d, want %d", len(setup.ingredientCategories), len(profile.IngredientCategories))
	}
	if setup.tables != fields.TableCount {
		t.Fatalf("tables = %d, want %d", setup.tables, fields.TableCount)
	}
	if restaurant == nil || member == nil || member.RestaurantID != restaurant.ID {
		t.Fatalf("created aggregate is inconsistent: restaurant=%#v member=%#v", restaurant, member)
	}
}

func TestCreateRestaurantWithStarterDataReturnsNoPartialAggregateOnFailure(t *testing.T) {
	setup := newRecordingRestaurantSetup()
	setup.failAfterRestaurantCreate = true

	restaurant, member, err := createRestaurantWithStarterData(
		setup,
		11,
		22,
		restaurantFields{Name: "Test", BranchName: "Main", RestaurantType: "restaurant", TableCount: 1},
		true,
	)
	if err == nil {
		t.Fatal("createRestaurantWithStarterData() error = nil, want failure")
	}
	if restaurant != nil || member != nil {
		t.Fatalf("partial aggregate returned after failure: restaurant=%#v member=%#v", restaurant, member)
	}
}

func TestSeedRestaurantStarterSetupFlatTablesSkipZones(t *testing.T) {
	setup := newRecordingRestaurantSetup()

	if err := seedRestaurantStarterSetup(setup, 1, "restaurant", 5, false); err != nil {
		t.Fatalf("seedRestaurantStarterSetup() error = %v", err)
	}

	if setup.tableZones != 0 {
		t.Fatalf("table zones = %d, want 0 when not splitting", setup.tableZones)
	}
	if setup.tables != 5 {
		t.Fatalf("tables = %d, want 5", setup.tables)
	}
	wantLabels := []string{"T1", "T2", "T3", "T4", "T5"}
	for i, table := range setup.createdTables {
		if table.ZoneID != nil {
			t.Fatalf("table %d has zone %v, want nil", i, *table.ZoneID)
		}
		if table.TableNumber != wantLabels[i] || table.DisplayLabel != wantLabels[i] {
			t.Fatalf("table %d label = %q/%q, want %q", i, table.TableNumber, table.DisplayLabel, wantLabels[i])
		}
		if table.SequenceNumber != i+1 {
			t.Fatalf("table %d sequence = %d, want %d", i, table.SequenceNumber, i+1)
		}
		if table.CustomerToken == "" {
			t.Fatalf("table %d has no customer token", i)
		}
	}
}

func TestSeedRestaurantStarterSetupZonedTablesCreateZones(t *testing.T) {
	setup := newRecordingRestaurantSetup()

	if err := seedRestaurantStarterSetup(setup, 1, "restaurant", 6, true); err != nil {
		t.Fatalf("seedRestaurantStarterSetup() error = %v", err)
	}

	if setup.tableZones == 0 {
		t.Fatal("table zones = 0, want the profile's zones when splitting")
	}
	for i, table := range setup.createdTables {
		if table.ZoneID == nil {
			t.Fatalf("table %d has no zone, want one when splitting", i)
		}
	}
}
