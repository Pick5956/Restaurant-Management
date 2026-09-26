import { describe, expect, it } from "vitest";

import { buildRestaurantPayload, expandFields, mergeSaved, planCommit, toForm, type FormState } from "./restaurantSettingsForm";

const messages = {
  validateName: "name",
  validateBranch: "branch",
  validatePhone: "phone",
  validateOpen: "open",
  validateClose: "close",
  validateTables: "tables",
  validateService: "service",
  validateVat: "vat",
  validateCoords: "coords",
  validateRadius: "radius",
};

const saved: FormState = toForm({
  name: "ครัวบ้านสวน",
  slug: "baan-suan",
  branch_name: "สาขาหลัก",
  phone: "0812345678",
  open_time: "17:00",
  close_time: "23:00",
  table_count: 12,
  service_charge_rate: 10,
  vat_rate: 7,
});

describe("planCommit", () => {
  it("sends only the field being saved, never what is half-typed elsewhere", () => {
    const screen = { ...saved, name: "ครัวบ้านสวน 2", phone: "08" };
    const plan = planCommit(saved, screen, ["name"], messages);

    expect(plan.kind).toBe("save");
    if (plan.kind !== "save") return;
    expect(plan.candidate.name).toBe("ครัวบ้านสวน 2");
    expect(plan.candidate.phone).toBe(saved.phone);
  });

  it("does nothing when the field is what is already saved", () => {
    expect(planCommit(saved, { ...saved, phone: "08" }, ["name"], messages)).toEqual({ kind: "unchanged" });
  });

  it("refuses an invalid value and reports only that field", () => {
    const plan = planCommit(saved, { ...saved, name: "  ", vat_rate: "99" }, ["name"], messages);

    expect(plan).toEqual({ kind: "invalid", errors: { name: "name" } });
  });

  it("saves the location check only as a whole, and only once it is complete", () => {
    const switchedOn = { ...saved, geofence_enabled: true, latitude: "", longitude: "" };
    expect(planCommit(saved, switchedOn, ["geofence_enabled"], messages)).toEqual({ kind: "invalid", errors: { latitude: "coords" } });

    const filled = { ...switchedOn, latitude: "13.736717", longitude: "100.523186" };
    const plan = planCommit(saved, filled, ["latitude"], messages);
    expect(plan.kind).toBe("save");
    if (plan.kind !== "save") return;
    expect(plan.candidate.geofence_enabled).toBe(true);
    expect(plan.candidate.longitude).toBe("100.523186");
  });
});

describe("expandFields", () => {
  it("brings the other location controls along with any one of them", () => {
    expect(expandFields(["name"])).toEqual(["name"]);
    expect(new Set(expandFields(["latitude"]))).toEqual(new Set(["latitude", "geofence_enabled", "longitude", "order_radius_meters"]));
  });
});

describe("mergeSaved", () => {
  it("takes the server's answer for the saved field and keeps the rest of the screen", () => {
    const screen = { ...saved, name: "typed", phone: "0899999999" };
    const merged = mergeSaved(screen, { ...saved, name: "From server" }, ["name"]);

    expect(merged.name).toBe("From server");
    expect(merged.phone).toBe("0899999999");
  });
});

describe("buildRestaurantPayload", () => {
  it("sends the slug only when it changed, and clears the location when the check is off", () => {
    expect(buildRestaurantPayload(saved, "baan-suan")).not.toHaveProperty("slug");
    expect(buildRestaurantPayload({ ...saved, slug: "baan-suan-2" }, "baan-suan")).toMatchObject({ slug: "baan-suan-2" });
    expect(buildRestaurantPayload(saved, "baan-suan")).toMatchObject({ latitude: null, longitude: null, order_radius_meters: 0 });
  });
});
