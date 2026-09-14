import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { selectOperationsSnapshot } from "@/src/lib/aiSnapshot";
import type { AISnapshot } from "@/src/types/ai";

const snapshot = (generatedAt: string) => ({ generated_at: generatedAt }) as AISnapshot;

describe("selectOperationsSnapshot", () => {
  it("keeps a newer current snapshot when an older request finishes later", () => {
    const current = snapshot("2026-08-03T12:00:01Z");
    expect(selectOperationsSnapshot(current, snapshot("2026-08-03T12:00:00Z"))).toBe(current);
  });

  it("accepts a newer valid snapshot and rejects missing or invalid timestamps", () => {
    const current = snapshot("2026-08-03T12:00:00Z");
    const newer = snapshot("2026-08-03T12:00:01Z");

    expect(selectOperationsSnapshot(current, newer)).toBe(newer);
    expect(selectOperationsSnapshot(current, null)).toBe(current);
    expect(selectOperationsSnapshot(current, snapshot("invalid"))).toBe(current);
  });
});

describe("AI snapshot integration", () => {
  const read = (relativePath: string) =>
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");

  // Nothing in the chat UI shows a snapshot any more. The AI page dropped its
  // stats block first; the floating chat's stats drawer went next (the owner
  // did not want it). A snapshot fetched by either is a request whose result is
  // stored and never shown — it must not creep back with the next feature that
  // "just needs the numbers"; whatever needs them should render them.
  it("keeps both chat surfaces off the snapshot endpoint they have nothing to show from", () => {
    for (const relative of ["../../app/(dashboard)/r/[slug]/ai-assistant/page.tsx", "../../components/shared/AIOperationsFloatingChat.tsx"]) {
      const source = read(relative);
      for (const dead of ["getOperationsSnapshot", "selectOperationsSnapshot", "latestSnapshot"]) {
        expect(source, `${relative} still references ${dead}`).not.toContain(dead);
      }
    }
  });
});
