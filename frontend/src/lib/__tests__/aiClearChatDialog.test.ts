import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The confirmation in front of deleting a chat is the last thing between a
// stray tap and a lost conversation, so the properties that make it safe are
// asserted here rather than left to a reviewer to notice.
//
// These are source-text checks. They cannot prove the dialog looks right — the
// owner checks that — but they do catch the ways it has room to silently stop
// protecting anything: reverting to the inline card that could be scrolled
// away from, focusing the destructive button on open, or losing the portal and
// being clipped inside the chat panel.
//
// Since chats became a list, "new chat" destroys nothing and asks nothing; the
// question moved to deleting a chat from the list, which lives in one place.

const root = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const dialog = read("src/components/shared/WarmConfirmDialog.tsx");
const styles = read("src/app/globals.css");
const chatList = read("src/components/shared/AIChatList.tsx");
const surfaces = {
  "floating chat": read("src/components/shared/AIOperationsFloatingChat.tsx"),
  "AI assistant page": read("src/app/(dashboard)/r/[slug]/ai-assistant/page.tsx"),
};

describe("chat deletion confirmation", () => {
  for (const [name, source] of Object.entries(surfaces)) {
    it(`${name} starts a new chat without asking and without deleting`, () => {
      // The old dialog deleted the thread; now the old chat stays in the list.
      expect(source).not.toMatch(/title=\{(labels|copy)\.(clearChatTitle|newChatTitle)\}/);
      expect(source).toContain("<AIChatList");
      expect(source).toContain("openThread(null)");
      // The inline card must never carry the destructive question either.
      const inlineBlocks = source.split("<AIInlineConfirm").slice(1);
      for (const block of inlineBlocks) {
        const props = block.slice(0, block.indexOf("/>"));
        expect(props).not.toMatch(/(clearChatConfirm|newChatConfirm|removeDescription)/);
      }
    });
  }

  it("the chat list asks through the modal before deleting, with a title and a body", () => {
    const calls = chatList
      .split("<WarmConfirmDialog")
      .slice(1)
      .map((call) => call.slice(0, call.indexOf("/>")));
    const remove = calls.find((props) => props.includes("t.removeTitle"));
    expect(remove).toBeDefined();
    expect(remove).toMatch(/description=\{[\s\S]{0,240}?removeDescription/);
    // Deleting is the red button. Renaming is not a dialog at all: the title
    // turns into a text field on its own row, so it never borrows the alarm.
    expect(remove).not.toContain('tone="primary"');
    expect(calls.some((props) => props.includes("t.renameTitle"))).toBe(false);
    expect(chatList).toContain("aria-label={t.renameTitle}");
  });

  it("opens with focus on the safe button", () => {
    // Enter is the reflex after a dialog appears. If it lands on "delete", the
    // confirmation has actively made things worse than no confirmation at all.
    // A caller may ask for its content field instead; the fallback is cancel.
    expect(dialog).toContain("(field ?? cancelRef.current)?.focus()");
    const confirmButton = dialog.slice(dialog.indexOf("warm-dialog-btn-danger"));
    expect(confirmButton.slice(0, confirmButton.indexOf("</button>"))).not.toContain("ref=");
  });

  it("escapes, traps tab, and restores focus", () => {
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("openerRef.current?.focus?.()");
  });

  it("renders through a portal so the chat panel cannot clip it", () => {
    // The floating chat sits inside a transformed, overflow-hidden container;
    // `position: fixed` inside a transformed ancestor is positioned against that
    // ancestor, so without the portal the dialog is trapped in the panel.
    expect(dialog).toContain("createPortal(");
    expect(dialog).toContain("document.body");
  });

  it("announces itself as an alert dialog", () => {
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain('aria-modal="true"');
    expect(dialog).toContain("aria-labelledby={titleId}");
    expect(dialog).toContain("aria-describedby={bodyId}");
  });

  it("keeps the terracotta focus ring instead of the browser default", () => {
    expect(styles).toMatch(/\.warm-dialog-btn:focus-visible[\s\S]{0,160}outline: 2px solid #c67139/);
    expect(styles).toMatch(/outline-offset: 2px/);
  });

  it("styles the destructive button as the only red surface", () => {
    expect(styles).toMatch(/\.warm-dialog-btn-danger\s*\{[^}]*background: #b3301c/);
    expect(styles).toMatch(/\.warm-dialog-btn-danger:hover\s*\{[^}]*background: #8f2415/);
    expect(styles).toMatch(/\.warm-dialog-btn-ghost\s*\{[^}]*background: transparent/);
  });

  it("has a dark-mode surface so the cream does not glare", () => {
    expect(styles).toContain(".dark .warm-dialog {");
    expect(styles).toContain(".dark .warm-dialog-btn-danger {");
  });
});
