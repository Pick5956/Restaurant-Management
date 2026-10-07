package service

// mooKataStarterProfile is the starter shop for the "ชาบู/ปิ้งย่าง" type, built as
// a หมูกระทะ restaurant: sets for the grill-and-soup pan, à la carte refills, and
// options that move stock — the soup and dipping sauce a set comes with, extra
// meat, and "ไม่เอาตับ" taking the liver back off the shelf count.
func mooKataStarterProfile() starterProfile {
	return starterProfile{
		TableZones: []starterTableZone{
			{Name: "โซนในร้าน", Prefix: "A", Capacity: 4},
			{Name: "ห้องแอร์", Prefix: "R", Capacity: 4},
			{Name: "โซนลานนอก", Prefix: "B", Capacity: 4},
			{Name: "โต๊ะกลุ่มใหญ่", Prefix: "V", Capacity: 8},
		},
		IngredientCategories: mooKataIngredientCategories(),
		Categories: []starterMenuCategory{
			{Name: "ชุดหมูกระทะ", Items: mooKataSets()},
			{Name: "เนื้อสัตว์เพิ่ม", Items: []starterMenuItem{
				mooKataRefill("หมูสามชั้นสไลซ์", 69, "หมูสามชั้นสไลซ์บาง", "หมูสามชั้นสไลซ์", 150),
				mooKataRefill("สันคอหมูหมัก", 69, "สันคอหมูหมักซอสงา", "สันคอหมูหมัก", 150),
				mooKataRefill("หมูนุ่มหมัก", 69, "หมูหมักนุ่มสูตรร้าน", "หมูนุ่มหมัก", 150),
				mooKataRefill("เนื้อวัวสไลซ์", 99, "เนื้อวัวสไลซ์ย่างเร็ว", "เนื้อวัวสไลซ์", 150),
				mooKataRefill("ไก่หมัก", 59, "สะโพกไก่หมักซีอิ๊ว", "ไก่หมัก", 150),
				mooKataRefill("ตับหมู", 49, "ตับหมูสไลซ์", "ตับหมู", 100),
			}},
			{Name: "ทะเลเพิ่ม", Items: []starterMenuItem{
				mooKataRefill("กุ้งสด", 99, "กุ้งขาวสดทั้งตัว", "กุ้ง", 150),
				mooKataRefill("หมึกสด", 89, "หมึกกล้วยหั่นแว่น", "หมึก", 150),
				mooKataRefill("ปลาดอลลี่", 69, "ปลาดอลลี่หั่นชิ้น", "ปลาดอลลี่", 150),
			}},
			{Name: "ผักและของเคียง", Items: mooKataSides()},
			{Name: "น้ำซุปและน้ำจิ้ม", Items: mooKataRefillSauces()},
			{Name: "เครื่องดื่ม", Items: mooKataDrinks()},
		},
	}
}

func mooKataIngredientCategories() []starterIngredientCategory {
	return []starterIngredientCategory{
		{
			Name: "เนื้อสัตว์และอาหารทะเล",
			Items: []starterIngredient{
				{Name: "หมูสามชั้นสไลซ์", Unit: "กรัม", Stock: 10000, MinStock: 2500, CostPerUnit: 0.2, YieldPercent: 100, StorageType: "chilled"},
				{Name: "สันคอหมูหมัก", Unit: "กรัม", Stock: 6000, MinStock: 1500, CostPerUnit: 0.22, YieldPercent: 100, StorageType: "chilled"},
				{Name: "หมูนุ่มหมัก", Unit: "กรัม", Stock: 6000, MinStock: 1500, CostPerUnit: 0.18, YieldPercent: 100, StorageType: "chilled"},
				{Name: "เนื้อวัวสไลซ์", Unit: "กรัม", Stock: 3000, MinStock: 800, CostPerUnit: 0.45, YieldPercent: 100, StorageType: "frozen"},
				{Name: "ไก่หมัก", Unit: "กรัม", Stock: 4000, MinStock: 1000, CostPerUnit: 0.12, YieldPercent: 100, StorageType: "chilled"},
				{Name: "ตับหมู", Unit: "กรัม", Stock: 2000, MinStock: 500, CostPerUnit: 0.1, YieldPercent: 100, StorageType: "chilled"},
				{Name: "กุ้ง", Unit: "กรัม", Stock: 4000, MinStock: 1000, CostPerUnit: 0.35, YieldPercent: 100, StorageType: "frozen"},
				{Name: "หมึก", Unit: "กรัม", Stock: 3000, MinStock: 800, CostPerUnit: 0.3, YieldPercent: 100, StorageType: "frozen"},
				{Name: "ปลาดอลลี่", Unit: "กรัม", Stock: 3000, MinStock: 800, CostPerUnit: 0.15, YieldPercent: 100, StorageType: "frozen"},
				{Name: "ลูกชิ้นรวม", Unit: "กรัม", Stock: 4000, MinStock: 1000, CostPerUnit: 0.18, YieldPercent: 100, StorageType: "frozen"},
				{Name: "ไข่ไก่", Unit: "ฟอง", Stock: 120, MinStock: 30, CostPerUnit: 4.5, YieldPercent: 100, StorageType: "chilled"},
				{Name: "มันหมูทากระทะ", Unit: "กรัม", Stock: 2000, MinStock: 500, CostPerUnit: 0.08, YieldPercent: 100, StorageType: "chilled"},
			},
		},
		{
			Name: "ผักและเส้น",
			Items: []starterIngredient{
				{Name: "ผักกาดขาว", Unit: "กรัม", Stock: 5000, MinStock: 1200, CostPerUnit: 0.04, YieldPercent: 100, StorageType: "chilled"},
				{Name: "ผักบุ้งจีน", Unit: "กรัม", Stock: 4000, MinStock: 1000, CostPerUnit: 0.05, YieldPercent: 100, StorageType: "chilled"},
				{Name: "กะหล่ำปลี", Unit: "กรัม", Stock: 4000, MinStock: 1000, CostPerUnit: 0.03, YieldPercent: 100, StorageType: "chilled"},
				{Name: "เห็ดเข็มทอง", Unit: "กรัม", Stock: 2000, MinStock: 500, CostPerUnit: 0.12, YieldPercent: 100, StorageType: "chilled"},
				{Name: "วุ้นเส้น", Unit: "กรัม", Stock: 2000, MinStock: 500, CostPerUnit: 0.1, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "ข้าวสาร", Unit: "กรัม", Stock: 20000, MinStock: 5000, CostPerUnit: 0.03, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "มันฝรั่งแช่แข็ง", Unit: "กรัม", Stock: 5000, MinStock: 1500, CostPerUnit: 0.06, YieldPercent: 100, StorageType: "frozen"},
			},
		},
		{
			Name: "น้ำซุปและน้ำจิ้ม",
			Items: []starterIngredient{
				{Name: "น้ำจิ้มหมูกระทะ", Unit: "มล.", Stock: 5000, MinStock: 1500, CostPerUnit: 0.06, YieldPercent: 100, StorageType: "chilled"},
				{Name: "น้ำจิ้มซีฟู้ด", Unit: "มล.", Stock: 3000, MinStock: 800, CostPerUnit: 0.08, YieldPercent: 100, StorageType: "chilled"},
				{Name: "น้ำจิ้มแจ่ว", Unit: "มล.", Stock: 3000, MinStock: 800, CostPerUnit: 0.06, YieldPercent: 100, StorageType: "chilled"},
				{Name: "น้ำซุปกระดูกหมู", Unit: "มล.", Stock: 20000, MinStock: 5000, CostPerUnit: 0.01, YieldPercent: 100, StorageType: "chilled"},
				{Name: "พริกแกงต้มยำ", Unit: "กรัม", Stock: 1000, MinStock: 250, CostPerUnit: 0.35, YieldPercent: 100, StorageType: "room_temp"},
			},
		},
		{
			Name: "ถ่านและของใช้",
			Items: []starterIngredient{
				{Name: "ถ่านไม้", Unit: "กรัม", Stock: 50000, MinStock: 10000, CostPerUnit: 0.012, YieldPercent: 100, StorageType: "room_temp"},
			},
		},
		{
			Name: "เครื่องดื่ม",
			Items: []starterIngredient{
				{Name: "น้ำเปล่าขวด", Unit: "ขวด", Stock: 96, MinStock: 24, CostPerUnit: 6, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "โซดาขวด", Unit: "ขวด", Stock: 48, MinStock: 12, CostPerUnit: 8, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "โค้กกระป๋อง", Unit: "กระป๋อง", Stock: 48, MinStock: 12, CostPerUnit: 10, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "สไปรท์กระป๋อง", Unit: "กระป๋อง", Stock: 48, MinStock: 12, CostPerUnit: 10, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "แฟนต้าน้ำแดงกระป๋อง", Unit: "กระป๋อง", Stock: 48, MinStock: 12, CostPerUnit: 10, YieldPercent: 100, StorageType: "room_temp"},
				{Name: "น้ำแข็ง", Unit: "กรัม", Stock: 50000, MinStock: 10000, CostPerUnit: 0.005, YieldPercent: 100, StorageType: "frozen"},
			},
		},
	}
}

// mooKataSets are the grill sets. The soup and dipping sauce are not in the base
// recipe: they come from the required option the waiter picks, so the shelf that
// drops is the one the table actually got.
func mooKataSets() []starterMenuItem {
	return []starterMenuItem{
		{
			Name: "ชุดหมูกระทะ 1-2 คน", Price: 299, Description: "หมูสามชั้น สันคอ หมูนุ่ม ตับ ลูกชิ้น ผัก วุ้นเส้น และไข่",
			OptionGroups: mooKataSetOptions(1, true),
			Recipe: []starterRecipeLine{
				{IngredientName: "หมูสามชั้นสไลซ์", Quantity: 150, Unit: "กรัม"},
				{IngredientName: "สันคอหมูหมัก", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "หมูนุ่มหมัก", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ตับหมู", Quantity: 50, Unit: "กรัม"},
				{IngredientName: "ลูกชิ้นรวม", Quantity: 60, Unit: "กรัม"},
				{IngredientName: "ไข่ไก่", Quantity: 1, Unit: "ฟอง"},
				{IngredientName: "ผักกาดขาว", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ผักบุ้งจีน", Quantity: 80, Unit: "กรัม"},
				{IngredientName: "กะหล่ำปลี", Quantity: 60, Unit: "กรัม"},
				{IngredientName: "เห็ดเข็มทอง", Quantity: 50, Unit: "กรัม"},
				{IngredientName: "วุ้นเส้น", Quantity: 40, Unit: "กรัม"},
				{IngredientName: "มันหมูทากระทะ", Quantity: 30, Unit: "กรัม"},
				{IngredientName: "ถ่านไม้", Quantity: 1000, Unit: "กรัม"},
			},
		},
		{
			Name: "ชุดหมูกระทะ 3-4 คน", Price: 549, Description: "ชุดใหญ่ หมูสามชั้น สันคอ หมูนุ่ม ตับ ลูกชิ้น ผัก วุ้นเส้น และไข่",
			OptionGroups: mooKataSetOptions(2, true),
			Recipe: []starterRecipeLine{
				{IngredientName: "หมูสามชั้นสไลซ์", Quantity: 300, Unit: "กรัม"},
				{IngredientName: "สันคอหมูหมัก", Quantity: 200, Unit: "กรัม"},
				{IngredientName: "หมูนุ่มหมัก", Quantity: 200, Unit: "กรัม"},
				{IngredientName: "ตับหมู", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ลูกชิ้นรวม", Quantity: 120, Unit: "กรัม"},
				{IngredientName: "ไข่ไก่", Quantity: 2, Unit: "ฟอง"},
				{IngredientName: "ผักกาดขาว", Quantity: 200, Unit: "กรัม"},
				{IngredientName: "ผักบุ้งจีน", Quantity: 160, Unit: "กรัม"},
				{IngredientName: "กะหล่ำปลี", Quantity: 120, Unit: "กรัม"},
				{IngredientName: "เห็ดเข็มทอง", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "วุ้นเส้น", Quantity: 80, Unit: "กรัม"},
				{IngredientName: "มันหมูทากระทะ", Quantity: 50, Unit: "กรัม"},
				{IngredientName: "ถ่านไม้", Quantity: 1500, Unit: "กรัม"},
			},
		},
		{
			Name: "ชุดทะเลรวม 2 คน", Price: 459, Description: "กุ้ง หมึก ปลาดอลลี่ หมูสามชั้น ผัก วุ้นเส้น และไข่",
			OptionGroups: mooKataSetOptions(1, false),
			Recipe: []starterRecipeLine{
				{IngredientName: "กุ้ง", Quantity: 150, Unit: "กรัม"},
				{IngredientName: "หมึก", Quantity: 150, Unit: "กรัม"},
				{IngredientName: "ปลาดอลลี่", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "หมูสามชั้นสไลซ์", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ไข่ไก่", Quantity: 1, Unit: "ฟอง"},
				{IngredientName: "ผักกาดขาว", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ผักบุ้งจีน", Quantity: 80, Unit: "กรัม"},
				{IngredientName: "เห็ดเข็มทอง", Quantity: 50, Unit: "กรัม"},
				{IngredientName: "วุ้นเส้น", Quantity: 40, Unit: "กรัม"},
				{IngredientName: "มันหมูทากระทะ", Quantity: 30, Unit: "กรัม"},
				{IngredientName: "ถ่านไม้", Quantity: 1000, Unit: "กรัม"},
			},
		},
	}
}

// mooKataSetOptions builds a set's option groups. scale multiplies the soup and
// sauce a set comes with (a 3-4 person pan gets twice the broth), and withLiver
// decides whether "ไม่เอาตับ" is offered — a seafood set has no liver to take off.
func mooKataSetOptions(scale float64, withLiver bool) []starterOptionGroup {
	adjustments := []starterOption{
		{Name: "ไม่เอาผักบุ้ง", Ingredients: []starterOptionIngredient{removeStock("ผักบุ้งจีน", 80*scale, "กรัม")}},
		{Name: "ไม่เอาวุ้นเส้น", Ingredients: []starterOptionIngredient{removeStock("วุ้นเส้น", 40*scale, "กรัม")}},
	}
	if withLiver {
		adjustments = append([]starterOption{
			{Name: "ไม่เอาตับ", Ingredients: []starterOptionIngredient{removeStock("ตับหมู", 50*scale, "กรัม")}},
		}, adjustments...)
	}
	return []starterOptionGroup{
		{
			Name: "น้ำซุป", Required: true, MinSelect: 1, MaxSelect: 1,
			Options: []starterOption{
				{Name: "ซุปกระดูกหมู", IsDefault: true, Ingredients: []starterOptionIngredient{
					addStock("น้ำซุปกระดูกหมู", 600*scale, "มล."),
				}},
				{Name: "ซุปต้มยำ", PriceDelta: 29, Ingredients: []starterOptionIngredient{
					addStock("น้ำซุปกระดูกหมู", 600*scale, "มล."),
					addStock("พริกแกงต้มยำ", 30*scale, "กรัม"),
				}},
			},
		},
		{
			Name: "น้ำจิ้ม", Required: true, MinSelect: 1, MaxSelect: 2,
			Options: []starterOption{
				{Name: "น้ำจิ้มหมูกระทะ", IsDefault: true, Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มหมูกระทะ", 100*scale, "มล.")}},
				{Name: "น้ำจิ้มซีฟู้ด", Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มซีฟู้ด", 100*scale, "มล.")}},
				{Name: "น้ำจิ้มแจ่ว", Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มแจ่ว", 100*scale, "มล.")}},
			},
		},
		{
			Name: "เพิ่มพิเศษ", MinSelect: 0, MaxSelect: 4,
			Options: []starterOption{
				{Name: "เพิ่มหมูสามชั้น", PriceDelta: 59, Ingredients: []starterOptionIngredient{addStock("หมูสามชั้นสไลซ์", 100, "กรัม")}},
				{Name: "เพิ่มสันคอหมูหมัก", PriceDelta: 59, Ingredients: []starterOptionIngredient{addStock("สันคอหมูหมัก", 100, "กรัม")}},
				{Name: "เพิ่มกุ้ง", PriceDelta: 79, Ingredients: []starterOptionIngredient{addStock("กุ้ง", 100, "กรัม")}},
				{Name: "เพิ่มไข่", PriceDelta: 10, Ingredients: []starterOptionIngredient{addStock("ไข่ไก่", 1, "ฟอง")}},
			},
		},
		{
			Name: "ปรับรายการ", MinSelect: 0, MaxSelect: len(adjustments),
			Options: adjustments,
		},
	}
}

// mooKataRefill is a plate of one meat or seafood. "จานใหญ่" adds half a plate on
// top, so the stock follows the size that went to the table.
func mooKataRefill(name string, price float64, description, ingredient string, grams float64) starterMenuItem {
	return starterMenuItem{
		Name: name, Price: price, Description: description,
		OptionGroups: []starterOptionGroup{
			{
				Name: "ขนาด", Required: true, MinSelect: 1, MaxSelect: 1,
				Options: []starterOption{
					{Name: "ปกติ", IsDefault: true},
					{Name: "จานใหญ่", PriceDelta: 40, Ingredients: []starterOptionIngredient{addStock(ingredient, grams/2, "กรัม")}},
				},
			},
		},
		Recipe: []starterRecipeLine{{IngredientName: ingredient, Quantity: grams, Unit: "กรัม"}},
	}
}

func mooKataSides() []starterMenuItem {
	return []starterMenuItem{
		{
			Name: "ผักรวม", Price: 39, Description: "ผักกาดขาว ผักบุ้ง และกะหล่ำปลี",
			Recipe: []starterRecipeLine{
				{IngredientName: "ผักกาดขาว", Quantity: 100, Unit: "กรัม"},
				{IngredientName: "ผักบุ้งจีน", Quantity: 80, Unit: "กรัม"},
				{IngredientName: "กะหล่ำปลี", Quantity: 60, Unit: "กรัม"},
			},
		},
		{
			Name: "เห็ดเข็มทอง", Price: 29, Description: "เห็ดเข็มทองสด",
			Recipe: []starterRecipeLine{{IngredientName: "เห็ดเข็มทอง", Quantity: 100, Unit: "กรัม"}},
		},
		{
			Name: "วุ้นเส้น", Price: 19, Description: "วุ้นเส้นลวกน้ำซุป",
			Recipe: []starterRecipeLine{{IngredientName: "วุ้นเส้น", Quantity: 80, Unit: "กรัม"}},
		},
		{
			Name: "ลูกชิ้นรวม", Price: 49, Description: "ลูกชิ้นหมู ลูกชิ้นปลา และเต้าหู้ปลา",
			Recipe: []starterRecipeLine{{IngredientName: "ลูกชิ้นรวม", Quantity: 120, Unit: "กรัม"}},
		},
		{
			Name: "ไข่ไก่", Price: 10, Description: "ไข่ไก่สด",
			Recipe: []starterRecipeLine{{IngredientName: "ไข่ไก่", Quantity: 1, Unit: "ฟอง"}},
		},
		{
			Name: "ข้าวสวย", Price: 15, Description: "ข้าวหอมมะลิ",
			Recipe: []starterRecipeLine{{IngredientName: "ข้าวสาร", Quantity: 100, Unit: "กรัม"}},
		},
		{
			Name: "เฟรนช์ฟรายส์", Price: 59, Description: "มันฝรั่งทอดกรอบ",
			Recipe: []starterRecipeLine{{IngredientName: "มันฝรั่งแช่แข็ง", Quantity: 150, Unit: "กรัม"}},
		},
	}
}

// mooKataRefillSauces have no base recipe: which pot or bowl is refilled is the
// option, and the option is what deducts.
func mooKataRefillSauces() []starterMenuItem {
	return []starterMenuItem{
		{
			Name: "เติมน้ำซุป", Price: 20, Description: "น้ำซุปเติมกระทะ",
			OptionGroups: []starterOptionGroup{
				{
					Name: "น้ำซุป", Required: true, MinSelect: 1, MaxSelect: 1,
					Options: []starterOption{
						{Name: "ซุปกระดูกหมู", IsDefault: true, Ingredients: []starterOptionIngredient{addStock("น้ำซุปกระดูกหมู", 500, "มล.")}},
						{Name: "ซุปต้มยำ", PriceDelta: 10, Ingredients: []starterOptionIngredient{
							addStock("น้ำซุปกระดูกหมู", 500, "มล."),
							addStock("พริกแกงต้มยำ", 25, "กรัม"),
						}},
					},
				},
			},
		},
		{
			Name: "น้ำจิ้มเพิ่ม", Price: 15, Description: "น้ำจิ้มถ้วยเพิ่ม",
			OptionGroups: []starterOptionGroup{
				{
					Name: "น้ำจิ้ม", Required: true, MinSelect: 1, MaxSelect: 1,
					Options: []starterOption{
						{Name: "น้ำจิ้มหมูกระทะ", IsDefault: true, Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มหมูกระทะ", 100, "มล.")}},
						{Name: "น้ำจิ้มซีฟู้ด", Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มซีฟู้ด", 100, "มล.")}},
						{Name: "น้ำจิ้มแจ่ว", Ingredients: []starterOptionIngredient{addStock("น้ำจิ้มแจ่ว", 100, "มล.")}},
					},
				},
			},
		},
		{
			Name: "เปลี่ยนถ่าน", Price: 30, Description: "ถ่านชุดใหม่ต่อเตา",
			Recipe: []starterRecipeLine{{IngredientName: "ถ่านไม้", Quantity: 1000, Unit: "กรัม"}},
		},
	}
}

func mooKataDrinks() []starterMenuItem {
	return []starterMenuItem{
		{
			Name: "น้ำอัดลม", Price: 25, Description: "น้ำอัดลมกระป๋อง",
			OptionGroups: []starterOptionGroup{
				{
					Name: "ชนิด", Required: true, MinSelect: 1, MaxSelect: 1,
					Options: []starterOption{
						{Name: "โค้ก", IsDefault: true, Ingredients: []starterOptionIngredient{addStock("โค้กกระป๋อง", 1, "กระป๋อง")}},
						{Name: "สไปรท์", Ingredients: []starterOptionIngredient{addStock("สไปรท์กระป๋อง", 1, "กระป๋อง")}},
						{Name: "แฟนต้าน้ำแดง", Ingredients: []starterOptionIngredient{addStock("แฟนต้าน้ำแดงกระป๋อง", 1, "กระป๋อง")}},
					},
				},
			},
		},
		{
			Name: "โซดา", Price: 20, Description: "โซดาขวด",
			Recipe: []starterRecipeLine{{IngredientName: "โซดาขวด", Quantity: 1, Unit: "ขวด"}},
		},
		{
			Name: "น้ำเปล่า", Price: 15, Description: "น้ำดื่มขวด",
			Recipe: []starterRecipeLine{{IngredientName: "น้ำเปล่าขวด", Quantity: 1, Unit: "ขวด"}},
		},
		{
			Name: "น้ำแข็งถัง", Price: 20, Description: "น้ำแข็งถังสำหรับทั้งโต๊ะ",
			Recipe: []starterRecipeLine{{IngredientName: "น้ำแข็ง", Quantity: 2000, Unit: "กรัม"}},
		},
	}
}
