// Command seed_daily_activity adds one day of realistic shop activity to the
// database so the demo restaurant looks like it operates every day rather than
// being a frozen snapshot: a run of orders that went all the way through —
// sent to the kitchen, cooked, served, paid, the table freed — with their cost
// deductions so margin stays honest, an expense or two, and the matching drop
// in ingredient stock.
//
// Until 18 ก.ย. 2569 each day also left three to five orders live on the floor
// for the assistant's "what is open right now". The owner asked for every bill
// closed properly instead: the morning after, the app showed four bills the
// kitchen had finished that nobody had marked served, one served and never
// paid, and five tables still occupied. Now nothing seeded is left open.
//
// It is meant to be run once at the start of each day. It is idempotent per day:
// every row it writes carries a marker note "[daily_activity YYYY-MM-DD]", so a
// second run for the same date does nothing unless -force is given, and -purge
// removes exactly what previous runs created.
//
// Usage:
//
//	go run ./cmd/seed_daily_activity                 (today, restaurant 1)
//	go run ./cmd/seed_daily_activity -date 2026-08-29
//	go run ./cmd/seed_daily_activity -force           (re-seed today)
//	go run ./cmd/seed_daily_activity -purge           (remove today's activity)
package main

import (
	"flag"
	"fmt"
	"hash/fnv"
	"log"
	"math/rand"
	"time"

	"gorm.io/gorm"

	"Project-M/config"
	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

func main() {
	restaurantID := flag.Uint("restaurant-id", 1, "restaurant to add activity for")
	dateFlag := flag.String("date", "", "day to seed as YYYY-MM-DD (default: today in Bangkok)")
	force := flag.Bool("force", false, "re-seed even if this day already has activity")
	purge := flag.Bool("purge", false, "remove the activity previously seeded for this day")
	restock := flag.Bool("restock", false, "top every ingredient that is below its minimum back up to a working level")
	calibrate := flag.Bool("calibrate", false, "set each ingredient's minimum from how fast it is actually used, then refill the shelves")
	// Backfilling a month of past days would otherwise run every shelf to zero
	// and sell out the whole menu today: those days' cooking was restocked long
	// ago. The day's sales, costs and expenses are still written.
	keepStock := flag.Bool("keep-stock", false, "record the day's sales without moving today's live stock (for backfilling past days)")
	flag.Parse()

	if err := config.LoadRuntimeEnvironment(); err != nil {
		log.Fatalf("env: %v", err)
	}
	if err := config.ConnectionDB(); err != nil {
		log.Fatalf("db: %v", err)
	}
	defer config.CloseDatabase()
	db := config.DB()

	loc := bangkok()
	day := time.Now().In(loc)
	if *dateFlag != "" {
		parsed, err := time.ParseInLocation("2006-01-02", *dateFlag, loc)
		if err != nil {
			log.Fatalf("bad -date %q: %v", *dateFlag, err)
		}
		day = parsed
	}
	dateStr := day.Format("2006-01-02")
	marker := fmt.Sprintf("[daily_activity %s]", dateStr)

	if *purge {
		purgeDay(db, *restaurantID, marker)
		return
	}

	if *restock {
		restockShelves(db, *restaurantID)
		return
	}

	if *calibrate {
		calibrateStock(db, *restaurantID)
		return
	}

	menus, err := loadMenus(db, *restaurantID)
	if err != nil || len(menus) == 0 {
		log.Fatalf("no menus for restaurant %d: %v", *restaurantID, err)
	}
	ingredients, err := loadIngredients(db, *restaurantID)
	if err != nil {
		log.Fatalf("load ingredients: %v", err)
	}
	staffID, err := resolveStaffID(db, *restaurantID)
	if err != nil {
		log.Fatalf("resolve staff: %v", err)
	}

	// Close what earlier seeded days left on the floor, and give every paid
	// seeded bill its payment row. Both run before the per-day guard so a
	// second run on the same day still tidies up, and both are no-ops once
	// caught up.
	settled, err := settleLeftovers(db, *restaurantID, dateStr, loc, ingredients, staffID)
	if err != nil {
		log.Fatalf("settle leftovers: %v", err)
	}
	backfilled, err := backfillPayments(db, *restaurantID, staffID)
	if err != nil {
		log.Fatalf("backfill payments: %v", err)
	}
	reportSettlement(settled, backfilled)
	// The stock the leftovers consumed is now subtracted; reload so today's
	// cost building sees the current shelf.
	if settled > 0 {
		if ingredients, err = loadIngredients(db, *restaurantID); err != nil {
			log.Fatalf("reload ingredients: %v", err)
		}
	}

	var existing int64
	db.Model(&entity.Order{}).
		Where("restaurant_id = ? AND note = ?", *restaurantID, marker).
		Count(&existing)
	if existing > 0 && !*force {
		log.Printf("วันที่ %s มีกิจกรรมแล้ว (%d ออเดอร์) ข้ามไป — ใช้ -force ถ้าจะเติมซ้ำ", dateStr, existing)
		return
	}
	if *force {
		purgeDay(db, *restaurantID, marker)
	}

	// Seeded from the date, so a given day always generates the same activity —
	// the idempotency guard already prevents double runs, and a stable seed makes
	// -force reproduce the same day rather than a different one.
	rng := rand.New(rand.NewSource(int64(hashDate(dateStr))))

	summary, err := seedDay(db, *restaurantID, marker, dateStr, day, loc, menus, ingredients, staffID, rng, *keepStock)
	if err != nil {
		log.Fatalf("seed day %s: %v", dateStr, err)
	}
	log.Printf("เติมกิจกรรมวันที่ %s แล้ว: ขายจบ %d ออเดอร์ (%.0f บาท) ปิดบิลครบทุกใบ · รายจ่าย %d รายการ · สต๊อกขยับ %d ตัว",
		dateStr, summary.completed, summary.revenue, summary.expenses, summary.stockMoved)
}

type daySummary struct {
	completed  int
	revenue    float64
	expenses   int
	stockMoved int
}

func seedDay(db *gorm.DB, restaurantID uint, marker, dateStr string, day time.Time, loc *time.Location,
	menus []entity.MenuItem, ingredients []entity.Ingredient, staffID uint, rng *rand.Rand, keepStock bool) (daySummary, error) {

	var summary daySummary
	// Total ingredient quantity consumed today, keyed by ingredient id, so the
	// live stock can be dropped by what the day's cooking actually used.
	consumed := map[uint]float64{}
	// Bills are numbered the way the POS numbers them — YYYYMMDD-NNN, carrying
	// on after anything already used that day — with " (Test)" after it.
	compactDate := day.Format("20060102")
	seq64, seqErr := repository.MaxOrderSequenceOn(db, restaurantID, dateStr)
	if seqErr != nil {
		return summary, seqErr
	}
	seq := int(seq64)

	err := db.Transaction(func(tx *gorm.DB) error {
		// Every table in the shop, for seating the day's dine-in bills. The
		// completed orders used to carry no table at all — only the three to five
		// live ones did — so thirty days of history showed one bill per table and
		// "โต๊ะไหนคนไม่ค่อยนั่ง" had nothing to rank. A closed bill remembers which
		// table it was served at, so the seeded ones do too.
		allTables := dineInTables(tx, restaurantID)

		// ---- completed, paid orders: the day's sales ------------------------
		completed := 18 + rng.Intn(11) // 18–28
		for i := 0; i < completed; i++ {
			seq++
			openedAt := mealTime(day, loc, rng)
			done := openedAt.Add(time.Duration(20+rng.Intn(50)) * time.Minute)
			fulfillment := entity.OrderItemFulfillmentDineIn
			orderType := entity.OrderTypeDineIn
			if rng.Float64() < 0.3 {
				orderType, fulfillment = entity.OrderTypeTakeaway, entity.OrderItemFulfillmentTakeaway
			}
			var seatedAt *uint
			if orderType == entity.OrderTypeDineIn {
				if table := pickTable(allTables, rng); table != nil {
					seatedAt = &table.ID
				}
			}
			order := &entity.Order{
				Model:         gorm.Model{CreatedAt: openedAt, UpdatedAt: done},
				RestaurantID:  restaurantID,
				OrderType:     orderType,
				OrderNumber:   fmt.Sprintf("%s-%03d%s", compactDate, seq, entity.TestOrderSuffix),
				OrderDate:     dateStr,
				StaffID:       staffID,
				CustomerCount: 1 + rng.Intn(4),
				Status:        entity.OrderStatusCompleted,
				PaymentStatus: entity.PaymentStatusPaid,
				Note:          marker,
				TableID:       seatedAt,
				OpenedAt:      openedAt,
				ClosedAt:      &done,
				CompletedAt:   &done,
				Version:       1,
			}
			if err := tx.Create(order).Error; err != nil {
				return err
			}
			items := buildItems(order, menus, fulfillment, done, rng)
			if err := tx.Create(&items).Error; err != nil {
				return err
			}
			total := 0.0
			for idx := range items {
				total += items[idx].Subtotal
				deductions, recipes := buildCost(&items[idx], ingredients, staffID, rng)
				for _, d := range deductions {
					consumed[d.IngredientID] += d.Quantity
				}
				if len(deductions) > 0 {
					if err := tx.Create(&deductions).Error; err != nil {
						return err
					}
				}
				if len(recipes) > 0 {
					if err := tx.Create(&recipes).Error; err != nil {
						return err
					}
				}
			}
			total = round2(total)
			if err := tx.Model(order).Updates(map[string]interface{}{
				"subtotal": total, "total_amount": total, "grand_total": total,
			}).Error; err != nil {
				return err
			}
			order.GrandTotal = total
			if err := tx.Create(seededPayment(*order, done, staffID, rng)).Error; err != nil {
				return err
			}
			summary.completed++
			summary.revenue += total
		}

		// ---- an expense or two: a restock, sometimes a utility bill ---------
		seeded := buildExpenses(restaurantID, day, staffID, marker, ingredients, rng)
		if len(seeded) > 0 {
			rows := make([]entity.Expense, 0, len(seeded))
			for _, item := range seeded {
				rows = append(rows, item.expense)
			}
			if err := tx.Create(&rows).Error; err != nil {
				return err
			}
			summary.expenses = len(rows)
		}
		if keepStock {
			return nil
		}

		// ---- drop live stock by what today's cooking consumed ---------------
		for ingredientID, qty := range consumed {
			if qty <= 0 {
				continue
			}
			// Clamp at zero: selling never drives recorded stock negative, it drives
			// it to empty and then the low-stock tools flag it.
			if err := tx.Model(&entity.Ingredient{}).
				Where("id = ? AND restaurant_id = ?", ingredientID, restaurantID).
				Update("stock", gorm.Expr("GREATEST(stock - ?, 0)", round2(qty))).Error; err != nil {
				return err
			}
			// Lots must follow the shelf: drain what was cooked, FEFO.
			if err := repository.ReconcileLotsToStock(tx, restaurantID, ingredientID, time.Now()); err != nil {
				return err
			}
			summary.stockMoved++
		}
		// The restock expense also puts stock back for the item it bought, so the
		// movement goes both ways and one ingredient climbs while others fall.
		for _, item := range seeded {
			if item.restockID == 0 {
				continue
			}
			if err := tx.Model(&entity.Ingredient{}).
				Where("id = ? AND restaurant_id = ?", item.restockID, restaurantID).
				Update("stock", gorm.Expr("stock + ?", restockUnits(item.expense.Amount))).Error; err != nil {
				return err
			}
			// The seeded delivery becomes a lot (undated: the seeder has no label to read).
			if err := repository.ReconcileLotsToStock(tx, restaurantID, item.restockID, time.Now()); err != nil {
				return err
			}
		}
		return nil
	})
	return summary, err
}

// Days of cover the calibration aims for. The minimum is the line where the
// shop should already be ordering, so it sits a couple of days ahead of running
// dry; the refill target is a week, which is what a small kitchen actually holds.
const (
	calibrateMinDays   = 2.0
	calibrateStockDays = 7.0
	calibrateWindow    = 30.0 // days of history the usage rate is read from
)

// calibrateStock sets each ingredient's minimum from how fast it is really used,
// then refills the shelves to about a week of cover.
//
// The demo data had minimums that bore no relation to consumption: soda is used
// 3,902 ml a day with its minimum set to 325 ml — a line the shop crosses within
// minutes of opening, so the panel warned about almost every ingredient, every
// day, and the warning stopped meaning anything. Restocking to three times that
// minimum did not help, because three times a wrong number is still wrong.
//
// Ingredients with no recorded usage are left alone: there is no consumption to
// derive a sensible minimum from, and their stock is a dead-stock question
// rather than a reorder one.
func calibrateStock(db *gorm.DB, restaurantID uint) {
	var ingredients []entity.Ingredient
	if err := db.Where("restaurant_id = ?", restaurantID).Find(&ingredients).Error; err != nil {
		log.Fatalf("load ingredients: %v", err)
	}

	type usageRow struct {
		IngredientID uint
		Used         float64
	}
	var rows []usageRow
	// order_inventory_deductions, not ingredient_transactions: the deductions are
	// what cooking actually consumed, and they are the same rows the assistant's
	// own "ใช้เฉลี่ย X/วัน" figure is computed from. Reading a different table
	// would tune the minimum against a number nobody sees.
	if err := db.Table("order_inventory_deductions").
		Select("ingredient_id, SUM(quantity) AS used").
		Where("created_at >= ? AND deleted_at IS NULL",
			time.Now().AddDate(0, 0, -int(calibrateWindow))).
		Group("ingredient_id").
		Scan(&rows).Error; err != nil {
		log.Fatalf("read usage: %v", err)
	}
	usedByID := make(map[uint]float64, len(rows))
	for _, r := range rows {
		usedByID[r.IngredientID] = r.Used
	}

	tuned, filled, untouched := 0, 0, 0
	for _, ing := range ingredients {
		dailyUse := usedByID[ing.ID] / calibrateWindow
		if dailyUse <= 0 {
			untouched++
			continue
		}
		updates := map[string]interface{}{
			"min_stock": round2(dailyUse * calibrateMinDays),
		}
		tuned++
		if target := round2(dailyUse * calibrateStockDays); ing.Stock < target {
			updates["stock"] = target
			filled++
		}
		if err := db.Model(&entity.Ingredient{}).
			Where("id = ? AND restaurant_id = ?", ing.ID, restaurantID).
			Updates(updates).Error; err != nil {
			log.Fatalf("calibrate %s: %v", ing.Name, err)
		}
	}
	log.Printf("ตั้งขั้นต่ำตามการใช้จริงแล้ว %d ตัว (พอใช้ %.0f วัน) · เติมสต๊อกให้พอใช้ %.0f วัน %d ตัว · ไม่แตะ %d ตัวที่ไม่มีการใช้เลย",
		tuned, calibrateMinDays, calibrateStockDays, filled, untouched)
}

// restockShelves refills every ingredient sitting at or below its minimum, the
// way an owner would after a delivery. It exists because a broken restock path
// let daily seeding drain the whole pantry: cooking subtracted every day, the
// purchase that was supposed to add stock back never ran, and twenty-four of
// twenty-seven ingredients ended up below their minimum. Fixing the seeding
// stops the bleeding; this puts the shelves back.
//
// The target is three times the minimum — enough that a day of cooking does not
// immediately drop it back into the warning band, and not so much that the
// inventory value stops looking like a real small shop's.
func restockShelves(db *gorm.DB, restaurantID uint) {
	var ingredients []entity.Ingredient
	if err := db.Where("restaurant_id = ?", restaurantID).Find(&ingredients).Error; err != nil {
		log.Fatalf("load ingredients: %v", err)
	}
	filled := 0
	for _, ing := range ingredients {
		target := ing.MinStock * 3
		if target <= 0 {
			// No minimum recorded, so there is no shortage to judge — leave it be
			// unless the shelf is actually empty.
			if ing.Stock > 0 {
				continue
			}
			target = 1000
		}
		if ing.Stock > ing.MinStock {
			continue
		}
		if err := db.Model(&entity.Ingredient{}).
			Where("id = ? AND restaurant_id = ?", ing.ID, restaurantID).
			Update("stock", round2(target)).Error; err != nil {
			log.Fatalf("restock %s: %v", ing.Name, err)
		}
		if err := repository.ReconcileLotsToStock(db, restaurantID, ing.ID, time.Now()); err != nil {
			log.Fatalf("reconcile lots %s: %v", ing.Name, err)
		}
		filled++
	}
	log.Printf("เติมสต๊อกให้วัตถุดิบที่ต่ำกว่าขั้นต่ำแล้ว %d ตัว จากทั้งหมด %d ตัว", filled, len(ingredients))
}

func buildItems(order *entity.Order, menus []entity.MenuItem, fulfillment string, servedAt time.Time, rng *rand.Rand) []entity.OrderItem {
	n := 1 + rng.Intn(4)
	if n > len(menus) {
		n = len(menus)
	}
	items := make([]entity.OrderItem, 0, n)
	// The kitchen's clock for this bill: sent a minute or two after it opened,
	// ready once cooked, carried out a few minutes later — all before the bill
	// closes at servedAt. They had all been one instant, so a finished order
	// read as cooked, served and paid in the same second.
	sentAt := order.OpenedAt.Add(time.Duration(1+rng.Intn(3)) * time.Minute)
	if sentAt.After(servedAt) {
		sentAt = servedAt
	}
	span := servedAt.Sub(sentAt)
	readyAt := sentAt.Add(span * time.Duration(55+rng.Intn(25)) / 100)
	carriedAt := readyAt.Add((servedAt.Sub(readyAt)) * time.Duration(20+rng.Intn(40)) / 100)
	for _, mi := range rng.Perm(len(menus))[:n] {
		menu := menus[mi]
		qty := 1
		if r := rng.Float64(); r > 0.93 {
			qty = 3
		} else if r > 0.7 {
			qty = 2
		}
		items = append(items, entity.OrderItem{
			Model:           gorm.Model{CreatedAt: order.OpenedAt, UpdatedAt: servedAt},
			OrderID:         order.ID,
			RestaurantID:    order.RestaurantID,
			MenuID:          menu.ID,
			MenuName:        menu.Name,
			UnitPrice:       menu.Price,
			Quantity:        qty,
			Subtotal:        round2(menu.Price * float64(qty)),
			FulfillmentType: fulfillment,
			Status:          entity.OrderItemStatusServed,
			KitchenBatch:    1,
			SentAt:          &sentAt,
			ReadyAt:         &readyAt,
			ServedAt:        &carriedAt,
		})
	}
	return items
}

func buildCost(item *entity.OrderItem, ingredients []entity.Ingredient, staffID uint, rng *rand.Rand) ([]entity.OrderInventoryDeduction, []entity.OrderItemRecipeSnapshot) {
	ratio := 0.30 + 0.15*float64(item.MenuID%100)/100.0
	target := round2(item.Subtotal * ratio)
	k := 2 + rng.Intn(2)
	if k > len(ingredients) {
		k = len(ingredients)
	}
	if k == 0 {
		return nil, nil
	}
	pick := rng.Perm(len(ingredients))[:k]
	deductions := make([]entity.OrderInventoryDeduction, 0, k)
	recipes := make([]entity.OrderItemRecipeSnapshot, 0, k)
	for i, ix := range pick {
		ing := ingredients[ix]
		part := round2(target / float64(k))
		if i == k-1 {
			part = round2(target - round2(target/float64(k))*float64(k-1))
		}
		if part < 0 {
			part = 0
		}
		unitCost := ing.CostPerUnit
		if unitCost <= 0 {
			unitCost = 1
		}
		qty := part / unitCost
		if qty <= 0 {
			qty = 0.0001
		}
		qtyPerItem := qty / float64(item.Quantity)
		if qtyPerItem <= 0 {
			qtyPerItem = 0.0001
		}
		deductions = append(deductions, entity.OrderInventoryDeduction{
			Model:        gorm.Model{CreatedAt: item.CreatedAt, UpdatedAt: item.CreatedAt},
			RestaurantID: item.RestaurantID,
			OrderID:      item.OrderID,
			OrderItemID:  item.ID,
			MenuItemID:   item.MenuID,
			IngredientID: ing.ID,
			Quantity:     qty,
			CostSnapshot: part,
			CreatedByID:  staffID,
		})
		recipes = append(recipes, entity.OrderItemRecipeSnapshot{
			Model:           gorm.Model{CreatedAt: item.CreatedAt, UpdatedAt: item.CreatedAt},
			RestaurantID:    item.RestaurantID,
			OrderID:         item.OrderID,
			OrderItemID:     item.ID,
			MenuItemID:      item.MenuID,
			IngredientID:    ing.ID,
			IngredientName:  ing.Name,
			Unit:            ing.Unit,
			QuantityPerItem: qtyPerItem,
			CostPerUnit:     ing.CostPerUnit,
			YieldPercent:    100,
		})
	}
	return deductions, recipes
}

// buildExpenses writes what an owner would actually enter on a normal day: an
// ingredient restock most days, and now and then a utility bill.
// seededExpense pairs a ledger row with the ingredient it restocks, if any.
// That link used to be smuggled through Expense.IngredientTransactionID, which
// points at a different table and is unique. Clearing it fixed the crash and
// silently killed the restock — the loop that adds stock back skipped every row,
// so the shelves only ever drained. Twenty-four of twenty-seven ingredients were
// below their minimum a day later. The link belongs here, beside the row, not in
// a column that means something else.
type seededExpense struct {
	expense entity.Expense
	// restockID is the ingredient this purchase puts back on the shelf; 0 when the
	// expense buys nothing stocked (a utility bill).
	restockID uint
}

func buildExpenses(restaurantID uint, day time.Time, staffID uint, marker string, ingredients []entity.Ingredient, rng *rand.Rand) []seededExpense {
	spentAt := time.Date(day.Year(), day.Month(), day.Day(), 9, rng.Intn(50), 0, 0, day.Location())
	expenses := []seededExpense{}

	if len(ingredients) > 0 {
		// Restock whichever ingredient is lowest, so the buy is one the shop needs.
		lowest := ingredients[0]
		for _, ing := range ingredients {
			if ing.Stock < lowest.Stock {
				lowest = ing
			}
		}
		amount := round2(600 + rng.Float64()*1900)
		// IngredientTransactionID is deliberately left nil. It means "this row was
		// written automatically by a stock-in", it is unique so one restock cannot
		// bill twice, and it points at ingredient_transactions — not at an
		// ingredient. It used to be filled with the ingredient's own ID, which was
		// the wrong table and, being unique, broke the whole seeding run on the
		// first day the same ingredient came up lowest twice (SQLSTATE 23505).
		// These rows stand for expenses the owner typed in, so nil is also correct.
		expenses = append(expenses, seededExpense{
			expense: entity.Expense{
				Model:        gorm.Model{CreatedAt: spentAt, UpdatedAt: spentAt},
				RestaurantID: restaurantID,
				Category:     "ingredient",
				Amount:       amount,
				SpentAt:      spentAt,
				Note:         marker + " ซื้อ" + lowest.Name,
				CreatedByID:  staffID,
			},
			restockID: lowest.ID,
		})
	}
	if rng.Float64() < 0.25 {
		utility := spentAt.Add(2 * time.Hour)
		expenses = append(expenses, seededExpense{expense: entity.Expense{
			Model:        gorm.Model{CreatedAt: utility, UpdatedAt: utility},
			RestaurantID: restaurantID,
			Category:     "utilities",
			Amount:       round2(150 + rng.Float64()*400),
			SpentAt:      utility,
			Note:         marker + " ค่าน้ำค่าไฟรายวัน",
			CreatedByID:  staffID,
		}})
	}
	return expenses
}

// restockUnits turns a baht restock into a rough unit count to add back to
// stock. It does not need to be exact — it only has to move the number.
func restockUnits(amount float64) float64 {
	return round2(amount / 5)
}

// dineInTables is every table the shop has, in a stable order.
func dineInTables(tx *gorm.DB, restaurantID uint) []entity.RestaurantTable {
	var tables []entity.RestaurantTable
	tx.Where("restaurant_id = ? AND deleted_at IS NULL", restaurantID).
		Order("id asc").Find(&tables)
	return tables
}

// pickTable seats one bill, and deliberately not evenly. A real shop fills the
// front tables first and the private room last, so the seeded history has a
// busiest and a quietest table to find; a uniform random pick would make every
// table identical and the question "which table is quiet" unanswerable in a
// different way — with a true answer of "all the same".
//
// The weight is 1/(rank+1): the first table is seated about twice as often as
// the fourth and four times as often as the tenth.
func pickTable(tables []entity.RestaurantTable, rng *rand.Rand) *entity.RestaurantTable {
	if len(tables) == 0 {
		return nil
	}
	total := 0.0
	for index := range tables {
		total += 1 / float64(index+1)
	}
	draw := rng.Float64() * total
	for index := range tables {
		draw -= 1 / float64(index+1)
		if draw <= 0 {
			return &tables[index]
		}
	}
	return &tables[len(tables)-1]
}

func purgeDay(db *gorm.DB, restaurantID uint, marker string) {
	var orders []entity.Order
	db.Where("restaurant_id = ? AND note = ?", restaurantID, marker).Find(&orders)
	ids := make([]uint, 0, len(orders))
	tableIDs := make([]uint, 0, len(orders))
	for _, order := range orders {
		ids = append(ids, order.ID)
		if order.TableID != nil {
			tableIDs = append(tableIDs, *order.TableID)
		}
	}
	if len(ids) > 0 {
		db.Where("order_id IN ?", ids).Delete(&entity.OrderPayment{})
		db.Where("order_id IN ?", ids).Delete(&entity.OrderInventoryDeduction{})
		db.Where("order_id IN ?", ids).Delete(&entity.OrderItemRecipeSnapshot{})
		db.Where("order_id IN ?", ids).Delete(&entity.OrderItem{})
		db.Where("id IN ?", ids).Delete(&entity.Order{})
	}
	if len(tableIDs) > 0 {
		db.Model(&entity.RestaurantTable{}).Where("id IN ?", tableIDs).
			Update("status", entity.TableStatusFree)
	}
	db.Where("restaurant_id = ? AND note LIKE ?", restaurantID, marker+"%").Delete(&entity.Expense{})
	log.Printf("ลบกิจกรรมของ %s แล้ว (%d ออเดอร์)", marker, len(ids))
}

func loadMenus(db *gorm.DB, restaurantID uint) ([]entity.MenuItem, error) {
	var menus []entity.MenuItem
	err := db.Where("restaurant_id = ? AND price > 0 AND deleted_at IS NULL", restaurantID).
		Find(&menus).Error
	return menus, err
}

func loadIngredients(db *gorm.DB, restaurantID uint) ([]entity.Ingredient, error) {
	var ingredients []entity.Ingredient
	err := db.Where("restaurant_id = ? AND deleted_at IS NULL", restaurantID).
		Find(&ingredients).Error
	return ingredients, err
}

func resolveStaffID(db *gorm.DB, restaurantID uint) (uint, error) {
	var member entity.RestaurantMember
	if err := db.Where("restaurant_id = ?", restaurantID).Order("id asc").First(&member).Error; err == nil {
		return member.UserID, nil
	} else if err != gorm.ErrRecordNotFound {
		return 0, err
	}
	var user entity.User
	if err := db.Order("id asc").First(&user).Error; err != nil {
		return 0, fmt.Errorf("no user to attribute orders to: %w", err)
	}
	return user.ID, nil
}

// mealTime scatters an order across the day, clustered on lunch and dinner the
// way a real shop's tickets are.
func mealTime(day time.Time, loc *time.Location, rng *rand.Rand) time.Time {
	var hour int
	switch {
	case rng.Float64() < 0.45: // lunch
		hour = 11 + rng.Intn(3)
	case rng.Float64() < 0.75: // dinner
		hour = 17 + rng.Intn(4)
	default: // the rest of opening hours
		hour = 10 + rng.Intn(11)
	}
	return time.Date(day.Year(), day.Month(), day.Day(), hour, rng.Intn(60), rng.Intn(60), 0, loc)
}

func hashDate(date string) uint32 {
	h := fnv.New32a()
	_, _ = h.Write([]byte(date))
	return h.Sum32()
}

func bangkok() *time.Location {
	if loc, err := time.LoadLocation("Asia/Bangkok"); err == nil {
		return loc
	}
	return time.FixedZone("Asia/Bangkok", 7*60*60)
}

func round2(v float64) float64 {
	return float64(int64(v*100+0.5)) / 100
}
