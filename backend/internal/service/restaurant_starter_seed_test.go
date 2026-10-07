package service

import (
	"testing"

	"Project-M/internal/entity"
)

func TestStarterProfileForRestaurantTypes(t *testing.T) {
	types := []string{"ร้านอาหาร", "คาเฟ่", "ชาบู/ปิ้งย่าง", "เดลิเวอรี", "ฟู้ดทรัค"}
	for _, restaurantType := range types {
		t.Run(restaurantType, func(t *testing.T) {
			profile := starterProfileFor(restaurantType)
			if len(profile.TableZones) == 0 {
				t.Fatalf("starter profile has no table zones")
			}
			if len(profile.Categories) == 0 {
				t.Fatalf("starter profile has no menu categories")
			}
			itemCount := 0
			for _, category := range profile.Categories {
				if len(category.Items) == 0 {
					t.Fatalf("category %q has no menu items", category.Name)
				}
				itemCount += len(category.Items)
			}
			if itemCount < 6 {
				t.Fatalf("starter profile has %d menu items, want at least 6", itemCount)
			}
		})
	}
}

// A recipe or option line naming an ingredient the catalog does not seed is
// skipped silently at setup, so a typo would ship a dish that never deducts.
func TestStarterProfileStockLinesNameSeededIngredients(t *testing.T) {
	types := []string{"ร้านอาหาร", "คาเฟ่", "ชาบู/ปิ้งย่าง", "เดลิเวอรี", "ฟู้ดทรัค"}
	for _, restaurantType := range types {
		t.Run(restaurantType, func(t *testing.T) {
			profile := starterProfileFor(restaurantType)
			units := map[string]string{}
			for _, category := range profile.IngredientCategories {
				for _, ingredient := range category.Items {
					units[ingredient.Name] = ingredient.Unit
				}
			}
			check := func(where, name, unit string, quantity float64) {
				stockUnit, ok := units[name]
				if !ok {
					t.Fatalf("%s names unseeded ingredient %q", where, name)
				}
				if unit != stockUnit {
					t.Fatalf("%s uses unit %q for %q, want stock unit %q", where, unit, name, stockUnit)
				}
				if quantity <= 0 {
					t.Fatalf("%s has quantity %v for %q, want > 0", where, quantity, name)
				}
			}
			for _, category := range profile.Categories {
				for _, item := range category.Items {
					for _, line := range item.Recipe {
						check(item.Name, line.IngredientName, line.Unit, line.Quantity)
					}
					for _, group := range item.OptionGroups {
						for _, option := range group.Options {
							for _, line := range option.Ingredients {
								check(item.Name+" / "+option.Name, line.IngredientName, line.Unit, line.Quantity)
							}
						}
					}
				}
			}
		})
	}
}

func TestMooKataSeedLinksOptionsToStock(t *testing.T) {
	setup := newRecordingRestaurantSetup()

	if err := seedRestaurantStarterSetup(setup, 1, "ชาบู/ปิ้งย่าง", 12, true); err != nil {
		t.Fatalf("seedRestaurantStarterSetup() error = %v", err)
	}

	if setup.tableZones != 4 {
		t.Fatalf("table zones = %d, want 4", setup.tableZones)
	}
	if len(setup.optionIngredients) == 0 {
		t.Fatal("no option ingredients seeded, want options that deduct stock")
	}
	directions := map[string]int{}
	for _, row := range setup.optionIngredients {
		if row.MenuOptionID == 0 || row.OptionGroupID == 0 || row.MenuItemID == 0 || row.IngredientID == 0 {
			t.Fatalf("option ingredient not linked: %#v", row)
		}
		directions[row.Direction]++
	}
	if directions[entity.MenuOptionIngredientAdd] == 0 || directions[entity.MenuOptionIngredientRemove] == 0 {
		t.Fatalf("directions = %v, want both add and remove", directions)
	}
}

func TestStarterZoneCountsSumToTableCount(t *testing.T) {
	tests := []struct {
		name       string
		tableCount int
		zoneCount  int
	}{
		{name: "single zone", tableCount: 4, zoneCount: 1},
		{name: "even split", tableCount: 12, zoneCount: 3},
		{name: "remainder split", tableCount: 14, zoneCount: 3},
		{name: "fewer tables than zones", tableCount: 2, zoneCount: 3},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			counts := starterZoneCounts(tt.tableCount, tt.zoneCount)
			if len(counts) != tt.zoneCount {
				t.Fatalf("got %d zone counts, want %d", len(counts), tt.zoneCount)
			}
			total := 0
			for _, count := range counts {
				total += count
			}
			if total != tt.tableCount {
				t.Fatalf("zone counts sum to %d, want %d", total, tt.tableCount)
			}
		})
	}
}
