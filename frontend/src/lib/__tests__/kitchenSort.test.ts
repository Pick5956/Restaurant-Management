import { describe, expect, it } from "vitest";

import { kitchenTicketStartedAt, sortKitchenTickets } from "../kitchenSort";

const at = (minute: number) => `2026-09-14T07:${String(minute).padStart(2, "0")}:00Z`;
const ticket = (tag: string, sentMinute: number | null) => ({
  tag,
  kitchen_sent_at: sentMinute === null ? null : at(sentMinute),
  opened_at: null,
  items: [],
});

describe("sortKitchenTickets", () => {
  const tickets = [ticket("mid", 20), ticket("old", 5), ticket("new", 40)];

  it("waiting puts the round that has waited longest first", () => {
    expect(sortKitchenTickets(tickets, "waiting").map((t) => t.tag)).toEqual(["old", "mid", "new"]);
  });

  it("latest puts the round that just arrived first", () => {
    expect(sortKitchenTickets(tickets, "latest").map((t) => t.tag)).toEqual(["new", "mid", "old"]);
  });

  it("sinks unstamped rounds and keeps ties in queue order", () => {
    const list = [ticket("x", null), ticket("b", 10), ticket("a", 10)];
    expect(sortKitchenTickets(list, "waiting").map((t) => t.tag)).toEqual(["b", "a", "x"]);
    expect(sortKitchenTickets(list, "latest").map((t) => t.tag)).toEqual(["b", "a", "x"]);
  });

  it("does not mutate the list it was given", () => {
    const list = [ticket("new", 40), ticket("old", 5)];
    sortKitchenTickets(list, "waiting");
    expect(list.map((t) => t.tag)).toEqual(["new", "old"]);
  });
});

describe("kitchenTicketStartedAt", () => {
  it("falls back to the earliest item send, then to when the bill opened", () => {
    expect(kitchenTicketStartedAt({ items: [{ sent_at: at(30) }, { sent_at: at(12) }] })).toBe(Date.parse(at(12)));
    expect(kitchenTicketStartedAt({ opened_at: at(3), items: [] })).toBe(Date.parse(at(3)));
    expect(kitchenTicketStartedAt({ items: [] })).toBeNull();
  });
});
