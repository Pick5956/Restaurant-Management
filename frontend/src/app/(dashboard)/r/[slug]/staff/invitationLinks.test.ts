import { describe, expect, it } from "vitest";
import { invitationLinkState, sortInvitationLinks } from "./staffPageUtils";

const NOW = new Date("2026-09-28T12:00:00Z");

describe("invitation links", () => {
  it("reads the state a person handed the link would meet", () => {
    expect(invitationLinkState({ status: "pending", expires_at: null }, NOW)).toBe("open");
    expect(invitationLinkState({ status: "pending", expires_at: "2026-10-05T00:00:00Z" }, NOW)).toBe("open");
    expect(invitationLinkState({ status: "accepted", expires_at: null }, NOW)).toBe("accepted");
    expect(invitationLinkState({ status: "revoked", expires_at: null }, NOW)).toBe("revoked");
    expect(invitationLinkState({ status: "expired", expires_at: null }, NOW)).toBe("expired");
  });

  it("counts a pending link past its expiry as expired, since nothing sweeps it", () => {
    expect(invitationLinkState({ status: "pending", expires_at: "2026-09-27T00:00:00Z" }, NOW)).toBe("expired");
  });

  it("lists open links first, then the rest newest first", () => {
    const links = [
      { ID: 1, status: "accepted" as const, expires_at: null, CreatedAt: "2026-09-28T10:00:00Z" },
      { ID: 2, status: "pending" as const, expires_at: null, CreatedAt: "2026-09-20T10:00:00Z" },
      { ID: 3, status: "revoked" as const, expires_at: null, CreatedAt: "2026-09-27T10:00:00Z" },
      { ID: 4, status: "pending" as const, expires_at: "2026-09-01T00:00:00Z", CreatedAt: "2026-09-28T11:00:00Z" },
    ];
    expect(sortInvitationLinks(links, NOW).map((link) => link.ID)).toEqual([2, 4, 1, 3]);
  });
});
