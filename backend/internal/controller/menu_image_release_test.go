package controller

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"Project-M/internal/entity"
)

func writeMenuImageFixture(t *testing.T, restaurantID uint, name string) string {
	t.Helper()
	directory, _ := menuUploadLocation(restaurantID)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatalf("create upload directory: %v", err)
	}
	path := filepath.Join(directory, name)
	if err := os.WriteFile(path, []byte("image"), 0o600); err != nil {
		t.Fatalf("write fixture %s: %v", name, err)
	}
	return path
}

func mustExist(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("%s should still exist: %v", filepath.Base(path), err)
	}
}

func mustBeGone(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("%s should have been removed, stat error = %v", filepath.Base(path), err)
	}
}

func TestRemoveUnreferencedMenuImageFreesOnlyThisRestaurantsOrphanedFile(t *testing.T) {
	t.Chdir(t.TempDir())
	orphaned := writeMenuImageFixture(t, 7, "orphaned.jpg")
	shared := writeMenuImageFixture(t, 7, "shared.png")
	foreign := writeMenuImageFixture(t, 8, "foreign.jpg")
	items := []entity.MenuItem{
		// The same file stored under a different public host still counts.
		{ImageURL: "http://localhost:8080/uploads/menu/7/shared.png"},
		{ImageURL: "https://api.example.test/uploads/menu/7/current.webp"},
	}

	removeUnreferencedMenuImage(7, "https://api.example.test/uploads/menu/7/shared.png", items)
	mustExist(t, shared)

	removeUnreferencedMenuImage(7, "https://api.example.test/uploads/menu/8/foreign.jpg", items)
	removeUnreferencedMenuImage(7, "https://api.example.test/uploads/menu/7/../8/foreign.jpg", items)
	mustExist(t, foreign)

	removeUnreferencedMenuImage(7, "", items)
	removeUnreferencedMenuImage(7, "https://cdn.example.test/orphaned.jpg", items)
	mustExist(t, orphaned)

	removeUnreferencedMenuImage(7, "https://api.example.test/uploads/menu/7/orphaned.jpg", items)
	mustBeGone(t, orphaned)
	mustExist(t, shared)

	// A reference stored without the leading slash is the same file: the
	// clients accept that form, so the file under it must be kept.
	relative := writeMenuImageFixture(t, 7, "relative.jpg")
	removeUnreferencedMenuImage(7, "https://api.example.test/uploads/menu/7/relative.jpg", []entity.MenuItem{{ImageURL: "uploads/menu/7/relative.jpg"}})
	mustExist(t, relative)
}

// A form opened before another device replaced the photo sends back a URL
// whose file is already gone. Only that case is stale: an external picture,
// an empty field or a file still on disk is saved as sent.
func TestStaleMenuImageIsOnlyAMissingTenantUpload(t *testing.T) {
	t.Chdir(t.TempDir())
	current := writeMenuImageFixture(t, 7, "current.jpg")
	mustExist(t, current)
	for imageURL, want := range map[string]bool{
		"https://api.example.test/uploads/menu/7/replaced.jpg": true,
		"uploads/menu/7/replaced.jpg":                          true,
		"https://api.example.test/uploads/menu/7/current.jpg":  false,
		"https://cdn.example.test/photo.jpg":                   false,
		"":                                                     false,
		"https://api.example.test/uploads/menu/8/other.jpg":    false,
	} {
		if got := staleMenuImage(7, imageURL); got != want {
			t.Errorf("staleMenuImage(%q) = %v, want %v", imageURL, got, want)
		}
	}
}

func TestUploadPathFromURLRefusesAnythingButATenantImageFile(t *testing.T) {
	directory := filepath.Join("uploads", "menu", "7")
	want := filepath.Join(directory, "photo.jpg")
	if got := uploadPathFromURL("https://api.example.test/uploads/menu/7/photo.jpg", "/uploads/menu/7/", directory); got != want {
		t.Fatalf("uploadPathFromURL() = %q, want %q", got, want)
	}
	if got := uploadPathFromURL("uploads/menu/7/photo.jpg", "/uploads/menu/7/", directory); got != want {
		t.Fatalf("uploadPathFromURL(no leading slash) = %q, want %q", got, want)
	}
	for _, imageURL := range []string{
		"",
		"uploads/menu/7/../8/photo.jpg",
		"https://api.example.test/uploads/menu/8/photo.jpg",
		"https://api.example.test/uploads/menu/7/",
		"https://api.example.test/uploads/menu/7/../8/photo.jpg",
		"https://api.example.test/uploads/menu/7/nested/photo.jpg",
		"https://api.example.test/uploads/menu/7/notes.txt",
		"https://cdn.example.test/photo.jpg",
	} {
		if got := uploadPathFromURL(imageURL, "/uploads/menu/7/", directory); got != "" {
			t.Fatalf("uploadPathFromURL(%q) = %q, want empty", imageURL, got)
		}
	}
}
