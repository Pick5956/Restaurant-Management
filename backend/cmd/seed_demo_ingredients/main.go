package main

import (
	"flag"
	"fmt"
	"log"
	"net/url"
	"strings"

	"Project-M/config"
	"Project-M/internal/entity"

	"gorm.io/gorm"
)

type demoIngredientCategory struct {
	Name        string
	Ingredients []demoIngredient
}

type demoIngredient struct {
	Name                    string
	SKU                     string
	ImageURL                string
	Unit                    string
	Stock                   float64
	MinStock                float64
	CostPerUnit             float64
	StorageType             string
}

func commonsFile(fileName string) string {
	return "https://commons.wikimedia.org/wiki/Special:FilePath/" + url.PathEscape(fileName) + "?width=800"
}

var demoIngredientCategories = []demoIngredientCategory{
	{
		Name: "เนื้อสัตว์และอาหารทะเล",
		Ingredients: []demoIngredient{
			{
				Name:                    "เนื้อหมู",
				SKU:                     "ING-MEAT-PORK",
				ImageURL:                commonsFile("Ground pork (cooked).jpg"),
				Unit:                    "กรัม",
				Stock:                   15000, // 15 kg
				MinStock:                2000,  // 2 kg
				CostPerUnit:             0.16,  // 160 THB/kg -> 0.16 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "เนื้อไก่ชิ้น",
				SKU:                     "ING-MEAT-CHICKEN-SLICED",
				ImageURL:                commonsFile("Raw Chicken Breast.jpg"),
				Unit:                    "กรัม",
				Stock:                   20000, // 20 kg
				MinStock:                3000,
				CostPerUnit:             0.095, // 95 THB/kg -> 0.095 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "กุ้งสด",
				SKU:                     "ING-SEAFOOD-SHRIMP",
				ImageURL:                commonsFile("Shrimp cooked.jpg"),
				Unit:                    "กรัม",
				Stock:                   10000, // 10 kg
				MinStock:                1500,
				CostPerUnit:             0.28, // 280 THB/kg -> 0.28 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "หมึกกล้วย",
				SKU:                     "ING-SEAFOOD-SQUID",
				ImageURL:                commonsFile("Fresh squid at market.jpg"),
				Unit:                    "กรัม",
				Stock:                   8000, // 8 kg
				MinStock:                1000,
				CostPerUnit:             0.22, // 220 THB/kg -> 0.22 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "เนื้อปูแกะ",
				SKU:                     "ING-SEAFOOD-CRAB",
				ImageURL:                commonsFile("Crab meat inside shell.jpg"),
				Unit:                    "กรัม",
				Stock:                   5000, // 5 kg
				MinStock:                500,
				CostPerUnit:             0.85, // 850 THB/kg -> 0.85 THB/g
				StorageType:             "chilled",
			},
		},
	},
	{
		Name: "ผักสดและสมุนไพร",
		Ingredients: []demoIngredient{
			{
				Name:                    "ใบกะเพรา",
				SKU:                     "ING-VEG-BASIL",
				ImageURL:                commonsFile("Holy Basil leaves.jpg"),
				Unit:                    "กรัม",
				Stock:                   3000, // 3 kg
				MinStock:                500,
				CostPerUnit:             0.05, // 50 THB/kg -> 0.05 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "มะนาวแป้น",
				SKU:                     "ING-VEG-LIME",
				ImageURL:                commonsFile("Thai lime.jpg"),
				Unit:                    "ลูก",
				Stock:                   200,
				MinStock:                30,
				CostPerUnit:             3.5, // 3.5 THB/lime
				StorageType:             "chilled",
			},
			{
				Name:                    "พริกขี้หนูสวน",
				SKU:                     "ING-VEG-CHILI",
				ImageURL:                commonsFile("Red Bird's Eye Chili.jpg"),
				Unit:                    "กรัม",
				Stock:                   2000,
				MinStock:                300,
				CostPerUnit:             0.12, // 120 THB/kg -> 0.12 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "กระเทียมไทย",
				SKU:                     "ING-VEG-GARLIC",
				ImageURL:                commonsFile("Garlic bulbs.jpg"),
				Unit:                    "กรัม",
				Stock:                   5000,
				MinStock:                1000,
				CostPerUnit:             0.09, // 90 THB/kg -> 0.09 THB/g
				StorageType:             "room_temp",
			},
			{
				Name:                    "ผักคะน้า",
				SKU:                     "ING-VEG-KANASE",
				ImageURL:                commonsFile("Chinese Broccoli.jpg"),
				Unit:                    "กรัม",
				Stock:                   8000,
				MinStock:                1500,
				CostPerUnit:             0.045, // 45 THB/kg -> 0.045 THB/g
				StorageType:             "chilled",
			},
			{
				Name:                    "มะละกอดิบ",
				SKU:                     "ING-VEG-PAPAYA",
				ImageURL:                commonsFile("Green papaya sliced.jpg"),
				Unit:                    "กรัม",
				Stock:                   10000,
				MinStock:                2000,
				CostPerUnit:             0.025, // 25 THB/kg -> 0.025 THB/g
				StorageType:             "room_temp",
			},
		},
	},
	{
		Name: "เครื่องปรุงรสและซอส",
		Ingredients: []demoIngredient{
			{
				Name:                    "น้ำปลาแท้",
				SKU:                     "ING-COND-FISHSANCE",
				ImageURL:                commonsFile("Thai fish sauce bottle.jpg"),
				Unit:                    "มิลลิลิตร",
				Stock:                   10000,
				MinStock:                2000,
				CostPerUnit:             0.04, // approx 28 THB/bottle -> 0.04 THB/ml
				StorageType:             "room_temp",
			},
			{
				Name:                    "ซอสหอยนางรม",
				SKU:                     "ING-COND-OYSTER",
				ImageURL:                commonsFile("Oyster sauce bowl.jpg"),
				Unit:                    "มิลลิลิตร",
				Stock:                   10000,
				MinStock:                2000,
				CostPerUnit:             0.05,
				StorageType:             "room_temp",
			},
			{
				Name:                    "น้ำตาลมะพร้าว",
				SKU:                     "ING-COND-COCOSugar",
				ImageURL:                commonsFile("Coconut palm sugar.jpg"),
				Unit:                    "กรัม",
				Stock:                   5000,
				MinStock:                1000,
				CostPerUnit:             0.065, // 65 THB/kg -> 0.065 THB/g
				StorageType:             "room_temp",
			},
			{
				Name:                    "น้ำมันพืช",
				SKU:                     "ING-COND-OIL",
				ImageURL:                commonsFile("Vegetable oil bottle.jpg"),
				Unit:                    "มิลลิลิตร",
				Stock:                   20000,
				MinStock:                3000,
				CostPerUnit:             0.045, // 45 THB/liter -> 0.045 THB/ml
				StorageType:             "room_temp",
			},
		},
	},
	{
		Name: "ของแห้งและวัตถุดิบอื่นๆ",
		Ingredients: []demoIngredient{
			{
				Name:                    "ข้าวหอมมะลิ",
				SKU:                     "ING-DRY-RICE",
				ImageURL:                commonsFile("Jasmine rice grains.jpg"),
				Unit:                    "กรัม",
				Stock:                   50000, // 50 kg
				MinStock:                10000,
				CostPerUnit:             0.035, // 0.035 THB/g -> 35 THB/kg
				StorageType:             "room_temp",
			},
			{
				Name:                    "ไข่ไก่ เบอร์ 2",
				SKU:                     "ING-DRY-EGG",
				ImageURL:                commonsFile("Chicken eggs brown.jpg"),
				Unit:                    "ฟอง",
				Stock:                   300,
				MinStock:                50,
				CostPerUnit:             4.2, // 4.2 THB/egg
				StorageType:             "room_temp",
			},
			{
				Name:                    "เส้นจันท์แห้ง",
				SKU:                     "ING-DRY-NOODLE-PADTHAI",
				ImageURL:                commonsFile("Dry rice noodles.jpg"),
				Unit:                    "กรัม",
				Stock:                   10000,
				MinStock:                2000,
				CostPerUnit:             0.055, // 55 THB/kg -> 0.055 THB/g
				StorageType:             "room_temp",
			},
			{
				Name:                    "เส้นใหญ่สด",
				SKU:                     "ING-DRY-NOODLE-SENYAI",
				ImageURL:                commonsFile("Fresh flat rice noodles.jpg"),
				Unit:                    "กรัม",
				Stock:                   8000,
				MinStock:                1500,
				CostPerUnit:             0.03, // 30 THB/kg -> 0.03 THB/g
				StorageType:             "room_temp",
			},
		},
	},
}

func main() {
	restaurantID := flag.Uint("restaurant-id", 0, "restaurant ID to seed demo ingredients into")
	flag.Parse()

	if *restaurantID == 0 {
		log.Fatal("missing -restaurant-id, example: go run ./cmd/seed_demo_ingredients -restaurant-id 1")
	}

	if err := config.LoadRuntimeEnvironment(); err != nil {
		log.Fatal(err)
	}
	if err := config.ValidateDatabaseEnvironment(); err != nil {
		log.Fatal(err)
	}
	if err := config.ConnectionDB(); err != nil {
		log.Fatal(err)
	}
	defer func() {
		if err := config.CloseDatabase(); err != nil {
			log.Printf("close database: %v", err)
		}
	}()
	if err := config.EnsureSchemaCurrent(config.DB()); err != nil {
		log.Fatal(err)
	}
	db := config.DB()

	var restaurant entity.Restaurant
	if err := db.First(&restaurant, *restaurantID).Error; err != nil {
		log.Fatalf("restaurant %d not found: %v", *restaurantID, err)
	}

	if err := seedDemoIngredients(db, uint(*restaurantID)); err != nil {
		log.Fatal(err)
	}

	fmt.Printf("Seeded clean ingredients successfully for restaurant %d\n", *restaurantID)
}

func seedDemoIngredients(db *gorm.DB, restaurantID uint) error {
	return db.Transaction(func(tx *gorm.DB) error {
		// Clean up existing recipe links for this restaurant so user can start fresh
		if err := tx.Where("restaurant_id = ?", restaurantID).Delete(&entity.MenuItemIngredient{}).Error; err != nil {
			return err
		}
		fmt.Println("Cleared all existing menu-ingredient recipe linkages for a clean start.")

		// Seed Categories & Ingredients
		ingredientCount := 0
		for catIndex, catSeed := range demoIngredientCategories {
			category, err := findOrCreateIngredientCategory(tx, restaurantID, catSeed.Name, catIndex+1)
			if err != nil {
				return err
			}

			for _, ingSeed := range catSeed.Ingredients {
				_, err := upsertIngredient(tx, restaurantID, category.ID, ingSeed)
				if err != nil {
					return err
				}
				ingredientCount++
			}
		}

		fmt.Printf("Successfully seeded %d ingredient items across %d categories.\n", ingredientCount, len(demoIngredientCategories))
		return nil
	})
}

func findOrCreateIngredientCategory(tx *gorm.DB, restaurantID uint, name string, displayOrder int) (*entity.IngredientCategory, error) {
	var category entity.IngredientCategory
	result := tx.Where("restaurant_id = ? AND name = ?", restaurantID, name).First(&category)
	if result.Error == nil {
		category.DisplayOrder = displayOrder
		category.IsActive = true
		return &category, tx.Save(&category).Error
	}
	if result.Error != gorm.ErrRecordNotFound {
		return nil, result.Error
	}

	category = entity.IngredientCategory{
		RestaurantID: restaurantID,
		Name:         name,
		DisplayOrder: displayOrder,
		IsActive:     true,
	}
	if err := tx.Create(&category).Error; err != nil {
		return nil, err
	}
	return &category, nil
}

func upsertIngredient(tx *gorm.DB, restaurantID, categoryID uint, seed demoIngredient) (uint, error) {
	var ingredient entity.Ingredient
	result := tx.Where("restaurant_id = ? AND name = ?", restaurantID, seed.Name).First(&ingredient)
	if result.Error != nil && result.Error != gorm.ErrRecordNotFound {
		return 0, result.Error
	}

	ingredient.RestaurantID = restaurantID
	ingredient.CategoryID = &categoryID
	ingredient.Name = strings.TrimSpace(seed.Name)
	ingredient.SKU = strings.TrimSpace(seed.SKU)
	ingredient.ImageURL = strings.TrimSpace(seed.ImageURL)
	ingredient.Unit = strings.TrimSpace(seed.Unit)
	ingredient.Stock = seed.Stock
	ingredient.MinStock = seed.MinStock
	// The seeded amount is a full shelf (owner, 29 ก.ย. 2569), so the stock
	// bar reads 100% instead of "ยังไม่รู้ว่าเต็มเท่าไหร่". Never below the
	// reorder level, the same rule a new ingredient follows.
	ingredient.MaxStock = seed.Stock
	if seed.MinStock > ingredient.MaxStock {
		ingredient.MaxStock = seed.MinStock
	}
	ingredient.CostPerUnit = seed.CostPerUnit
	// Always 100: stock is recorded as net weight and CostPerUnit is the cost of
	// that net unit, so a second yield division would double-count trim waste.
	// The inventory form no longer exposes yield, so a seeded value below 100
	// would silently inflate dish cost with no way to correct it from the UI.
	ingredient.YieldPercent = 100
	ingredient.StorageType = seed.StorageType

	if result.Error == gorm.ErrRecordNotFound {
		if err := tx.Create(&ingredient).Error; err != nil {
			return 0, err
		}
	} else if err := tx.Save(&ingredient).Error; err != nil {
		return 0, err
	}

	return ingredient.ID, nil
}
