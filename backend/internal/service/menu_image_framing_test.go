package service

import (
	"math"
	"testing"

	"Project-M/internal/entity"
)

func ptrFloat(value float64) *float64 { return &value }

func framedItem() *entity.MenuItem {
	return &entity.MenuItem{
		ImageURL:         "/uploads/menu/1/crop.webp",
		ImageOriginalURL: "/uploads/menu/1/original.webp",
		ImageCropZoom:    -40,
		ImageCropX:       0.2,
		ImageCropY:       0.9,
	}
}

func TestMenuImageFramingStoresWhatTheWebEditorSends(t *testing.T) {
	item := framedItem()
	req := &MenuItemRequest{
		ImageURL:         "/uploads/menu/1/new-crop.webp",
		ImageOriginalURL: ptrString(" /uploads/menu/1/new-original.webp "),
		ImageCropZoom:    ptrFloat(35),
		ImageCropX:       ptrFloat(0.25),
		ImageCropY:       ptrFloat(0.75),
	}
	item.ImageURL = req.ImageURL
	if err := applyMenuImageFraming(item, req, "/uploads/menu/1/crop.webp"); err != nil {
		t.Fatal(err)
	}
	if item.ImageOriginalURL != "/uploads/menu/1/new-original.webp" || item.ImageCropZoom != 35 || item.ImageCropX != 0.25 || item.ImageCropY != 0.75 {
		t.Fatalf("framing not stored: %+v", item)
	}
}

func TestMenuImageFramingIsClampedToTheEditorsRange(t *testing.T) {
	item := framedItem()
	req := &MenuItemRequest{
		ImageURL:         item.ImageURL,
		ImageOriginalURL: ptrString("/uploads/menu/1/original.webp"),
		ImageCropZoom:    ptrFloat(400),
		ImageCropX:       ptrFloat(-3),
		ImageCropY:       ptrFloat(9),
	}
	if err := applyMenuImageFraming(item, req, item.ImageURL); err != nil {
		t.Fatal(err)
	}
	if item.ImageCropZoom != 100 || item.ImageCropX != 0 || item.ImageCropY != 1 {
		t.Fatalf("framing not clamped: %+v", item)
	}
}

func TestMenuImageFramingRejectsNonFiniteNumbers(t *testing.T) {
	item := framedItem()
	req := &MenuItemRequest{ImageURL: item.ImageURL, ImageCropZoom: ptrFloat(math.NaN())}
	if err := applyMenuImageFraming(item, req, item.ImageURL); err == nil {
		t.Fatal("NaN zoom was accepted")
	}
}

// The Expo editor posts the item without framing fields. If it did not touch
// the photo, what the web stored stays.
func TestMenuImageFramingSurvivesASaveThatDoesNotMentionIt(t *testing.T) {
	item := framedItem()
	req := &MenuItemRequest{ImageURL: item.ImageURL}
	if err := applyMenuImageFraming(item, req, item.ImageURL); err != nil {
		t.Fatal(err)
	}
	if item.ImageOriginalURL != "/uploads/menu/1/original.webp" || item.ImageCropZoom != -40 || item.ImageCropX != 0.2 || item.ImageCropY != 0.9 {
		t.Fatalf("framing lost on a save that did not change the photo: %+v", item)
	}
}

// A new photo from a client that sends no framing leaves the old original
// behind: it is not the photo any more, so reopening it would show the wrong
// dish. The framing starts again from the photo itself.
func TestMenuImageFramingIsDroppedWhenThePhotoChangesWithoutIt(t *testing.T) {
	item := framedItem()
	item.ImageURL = "/uploads/menu/1/from-the-app.webp"
	req := &MenuItemRequest{ImageURL: item.ImageURL}
	if err := applyMenuImageFraming(item, req, "/uploads/menu/1/crop.webp"); err != nil {
		t.Fatal(err)
	}
	if item.ImageOriginalURL != "" || item.ImageCropZoom != 0 || item.ImageCropX != 0.5 || item.ImageCropY != 0.5 {
		t.Fatalf("stale original kept after the photo changed: %+v", item)
	}
}

func TestMenuImageFramingIsDroppedWithThePhoto(t *testing.T) {
	item := framedItem()
	item.ImageURL = ""
	req := &MenuItemRequest{ImageURL: "", ImageOriginalURL: ptrString("/uploads/menu/1/original.webp")}
	if err := applyMenuImageFraming(item, req, "/uploads/menu/1/crop.webp"); err != nil {
		t.Fatal(err)
	}
	if item.ImageOriginalURL != "" {
		t.Fatalf("original kept for a dish with no photo: %+v", item)
	}
}
