import { readFile } from "node:fs/promises";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AIAssistantErrorState from "@/src/components/shared/AIAssistantErrorState";
import {
  AIResponsePlainTextFallback,
} from "@/src/components/shared/SafeAIResponseContent";

describe("AI assistant error recovery", () => {
  it("keeps the original answer visible when rich formatting fails", () => {
    const content = "1. เลือกบทบาท\n2. สร้างลิงก์คำเชิญ";
    const markup = renderToStaticMarkup(
      <AIResponsePlainTextFallback content={content} language="th" />
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("แสดงเป็นข้อความแทน");
    expect(markup).toContain("สร้างลิงก์คำเชิญ");
  });

  it("offers local recovery without telling the user to reload the whole page", () => {
    const markup = renderToStaticMarkup(
      <AIAssistantErrorState
        language="th"
        onRetry={() => undefined}
        onStartNewChat={() => undefined}
      />
    );

    expect(markup).toContain("แชทสะดุดชั่วคราว");
    expect(markup).toContain("ลองอีกครั้ง");
    expect(markup).toContain("เริ่มแชทใหม่");
    expect(markup).toContain("ตรวจสอบสถานะล่าสุด");
    expect(markup).not.toContain("ข้อมูลร้านไม่ได้ถูกแก้ไข");
    expect(markup).not.toMatch(/reload|รีโหลด/i);
  });

  it("isolates answer rendering in both chat surfaces and provides a route boundary", async () => {
    const [page, floating, routeBoundary] = await Promise.all([
      readFile(new URL("../../app/(dashboard)/r/[slug]/ai-assistant/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../components/shared/AIOperationsFloatingChat.tsx", import.meta.url), "utf8"),
      readFile(new URL("../../app/(dashboard)/r/[slug]/ai-assistant/error.tsx", import.meta.url), "utf8"),
    ]);

    expect(page).toContain("<SafeAIResponseContent");
    expect(floating).toContain("<SafeAIResponseContent");
    expect(routeBoundary).toContain("<AIAssistantErrorState");
    expect(routeBoundary).not.toMatch(/location\.reload|window\.location/);
  });
});
