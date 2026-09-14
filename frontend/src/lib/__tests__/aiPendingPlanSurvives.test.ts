import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Both chat surfaces used to drop the pending plan the moment the owner typed
// anything else. The server kept it — one plan at a time is its rule — so the
// next command came back with "there is still something waiting, confirm or
// cancel it above" pointing at a box that had just been removed from the screen.
// Neither button existed any more, so the only way out was to wait for the plan
// to expire. The bar has its own countdown and terminal states; it is meant to
// stay up until the owner deals with it.
describe("a pending write plan survives the next question", () => {
  const sources = [
    ["floating chat", "../../components/shared/AIOperationsFloatingChat.tsx"],
    ["AI page", "../../app/(dashboard)/r/[slug]/ai-assistant/page.tsx"],
  ] as const;

  for (const [name, relativePath] of sources) {
    it(`is not cleared while sending in the ${name}`, () => {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
      // The send path is recognisable by the input being emptied. Whatever else it
      // resets, the plan must not be among it.
      const sendIndex = source.indexOf('setInput("")');
      expect(sendIndex).toBeGreaterThan(-1);
      const sendBlock = source.slice(sendIndex, sendIndex + 900);
      expect(sendBlock).not.toContain("setPendingActionPlan(null)");
    });

    // The other half of the same complaint: the card was gone after switching
    // to another page and back, because it lived only in component state while
    // the server still held the plan.
    it(`is restored after a page switch in the ${name}`, () => {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
      // Keyed by the chat, not the restaurant: each conversation keeps its own
      // card, and switching chats does not carry one across.
      expect(source).toContain("loadPendingPlan(threadStorageKey)");
      expect(source).toContain("savePendingPlan(threadStorageKey, pendingActionPlan, planCardState)");
      // And it comes back in the state it ended in, so a card already answered
      // does not offer the buttons a second time.
      expect(source).toContain("initialState={planCardState}");
    });
  }
});
