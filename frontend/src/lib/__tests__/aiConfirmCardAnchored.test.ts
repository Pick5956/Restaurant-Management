import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A confirmation card has to sit under the answer that proposed it.
//
// Both chat surfaces used to render these cards after messages.map, which put
// them last in the thread no matter which message created them. Ask another
// question while a card was open and it slid down to sit under the new answer,
// reading as though it belonged to the question just asked; once resolved,
// "ยกเลิกแล้ว" kept following the conversation down forever.
//
// The two properties asserted here are the ones that make the fix work AND keep
// it safe. Anchoring alone would be a regression: with no owning message the
// card would vanish, and the server refuses every other command until a pending
// plan is confirmed or cancelled — which is a deadlock the owner cannot escape.

const root = join(__dirname, "..", "..", "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

const surfaces = {
  "floating chat": read("src/components/shared/AIOperationsFloatingChat.tsx"),
  "AI assistant page": read("src/app/(dashboard)/r/[slug]/ai-assistant/page.tsx"),
};

describe("pending confirmation cards", () => {
  for (const [name, source] of Object.entries(surfaces)) {
    it(`${name} tags each answer with the card it created`, () => {
      expect(source).toContain("planId: data.action_plan?.id");
      expect(source).toContain("previewId: data.action_preview?.id");
      expect(source).toMatch(/planAnchorId\s*=\s*pendingActionPlan/);
      expect(source).toMatch(/previewAnchorId\s*=\s*pendingActionPreview/);
    });

    it(`${name} renders the card against its own message`, () => {
      // Inside the map, keyed on the message being rendered.
      expect(source).toContain("{planAnchorId === msg.id && planCard}");
      expect(source).toContain("{previewAnchorId === msg.id && previewCard}");
    });

    it(`${name} still shows a card whose message is gone`, () => {
      // The fallback. Without it an owner whose thread was restored from storage
      // gets a pending plan they can neither see nor cancel, and every command
      // after it is refused.
      expect(source).toContain("{planAnchorId === null && planCard}");
      expect(source).toContain("{previewAnchorId === null && previewCard}");
    });

    it(`${name} does not render the card unconditionally at the end`, () => {
      // The exact shape of the old bug: a bare `pendingActionPlan && <card>` in
      // the thread body, with nothing tying it to a message.
      const tail = source.slice(source.indexOf("messagesEndRef} />"));
      expect(tail).not.toMatch(/\{pendingActionPlan\s*&&/);
      expect(tail).not.toMatch(/\{pendingActionPreview\s*&&/);
    });
  }
});
