package service

import (
	"strings"
	"testing"

	"Project-M/internal/entity"
	"Project-M/internal/repository"
)

// The card asks what the stock page's form asks (28 ก.ย. 2569): the section of
// the stock list, the opening lot's expiry, and the case a pack comes in.
func TestIngredientSetupCarriesCategoryExpiryAndCase(t *testing.T) {
	sauces := entity.IngredientCategory{Name: "เครื่องปรุง", IsActive: true}
	sauces.ID = 5
	categories := []entity.IngredientCategory{sauces}
	answers := AIIngredientSetupAnswers{Unit: "มิลลิลิตร", PackUnit: "ขวด", PackSize: 700, PriceMode: aiSetupPricePerPack, Price: 35}

	// Nothing chosen yet: no section, the storage type's shelf life, no case.
	payload, preview, err := buildIngredientSetup(nil, categories, "น้ำปลา", 2, "ขวด", answers)
	if err != nil {
		t.Fatal(err)
	}
	view := preview.Setup
	if view.CategoryID != 0 || len(view.Categories) != 1 || view.Categories[0].Name != "เครื่องปรุง" {
		t.Fatalf("categories = %+v chosen %d", view.Categories, view.CategoryID)
	}
	want := repository.BangkokNow().AddDate(0, 0, 2).Format("2006-01-02")
	if view.ExpiryDays != 2 || view.ExpirySet || view.ExpiresAt != want || payload.ExpiresAt != want {
		t.Fatalf("room-temperature default should be 2 days (%s): %+v", want, view)
	}
	if !view.CanCase || len(view.Missing) != 0 {
		t.Fatalf("a bottle size makes a case possible, nothing missing: %+v", view)
	}

	// The default follows the storage type until the owner picks a date.
	answers.StorageType = "dry"
	_, preview, _ = buildIngredientSetup(nil, categories, "น้ำปลา", 2, "ขวด", answers)
	if preview.Setup.ExpiryDays != 180 || preview.Setup.ExpiryOptions[0] != 180 {
		t.Fatalf("dry goods should default to 180 days: %+v", preview.Setup)
	}

	// Chosen: the section, "ไม่ระบุ" for the expiry, a case of 12 bottles.
	none := 0
	answers.CategoryID, answers.ExpiryDays, answers.CaseUnit, answers.CaseSize = 5, &none, "ลัง", 12
	payload, preview, err = buildIngredientSetup(nil, categories, "น้ำปลา", 2, "ขวด", answers)
	if err != nil {
		t.Fatal(err)
	}
	if payload.CategoryID != 5 || payload.ExpiresAt != "" || payload.CaseUnit != "ลัง" || payload.CaseSize != 12 {
		t.Fatalf("chosen answers not carried: %+v", payload)
	}
	facts := ""
	for _, fact := range preview.Facts {
		facts += fact.Label + "=" + fact.Value + ";"
	}
	if !strings.Contains(facts, "ยกลัง=ลังละ 12 ขวด") || !strings.Contains(facts, "หมวด=เครื่องปรุง") || strings.Contains(facts, "หมดอายุ") {
		t.Fatalf("review lines = %s", facts)
	}

	// A case with no size is asked for; a section from another shop is refused.
	answers.CaseSize = 0
	_, preview, _ = buildIngredientSetup(nil, categories, "น้ำปลา", 2, "ขวด", answers)
	if len(preview.Setup.Missing) == 0 {
		t.Fatal("a case without its size must be listed as missing")
	}
	answers.CategoryID = 99
	if _, _, err := buildIngredientSetup(nil, categories, "น้ำปลา", 2, "ขวด", answers); err == nil {
		t.Fatal("an unknown section must be refused")
	}
}
