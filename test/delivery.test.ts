import { describe, expect, it } from "vitest";
import { filterSlotsByDates, listDeliverySlots } from "../src/api/delivery.js";
import { HaziHinamClient } from "../src/client.js";
import { fakeFetch } from "./helpers.js";

const shipment = (id: number, date: string, overrides = {}) => ({
  ShipmentId: id, DOW: "חמישי", Date: date, Time: { From: "19:00", To: "21:00" },
  IsClosedShipment: false, IsExceeds: false, IsSelfPickUp: false, ...overrides,
});

const deliveries = {
  Addresses: [{
    Id: 7, Name: "Home", IsDefault: true,
    ShipmentsByDate: [
      { DOW: "חמישי", Date: "01/10/2026", Shipments: [shipment(1, "01/10/2026", { IsClosedShipment: true })] },
      { DOW: "שישי", Date: "02/10/2026", Shipments: [shipment(3, "02/10/2026", { IsExceeds: true })] },
      { DOW: "חמישי", Date: "08/10/2026", Shipments: [shipment(2, "08/10/2026")] },
    ],
  }],
  Stores: [],
};

describe("delivery slots", () => {
  it("normalizes slots and marks closed or full ones unavailable", async () => {
    const f = fakeFetch({ "GET delivery/getNextDeliveries": deliveries });
    const [home] = await listDeliverySlots(new HaziHinamClient("t", { fetch: f.fetch }));
    expect(home).toMatchObject({ addressId: 7, name: "Home", isDefault: true });
    expect(home.slots).toEqual([
      { shipmentId: 1, date: "2026-10-01", dayName: "חמישי", from: "19:00", to: "21:00", available: false },
      { shipmentId: 3, date: "2026-10-02", dayName: "שישי", from: "19:00", to: "21:00", available: false },
      { shipmentId: 2, date: "2026-10-08", dayName: "חמישי", from: "19:00", to: "21:00", available: true },
    ]);
  });

  it("filters slots to the requested dates", async () => {
    const f = fakeFetch({ "GET delivery/getNextDeliveries": deliveries });
    const all = await listDeliverySlots(new HaziHinamClient("t", { fetch: f.fetch }));
    const [home] = filterSlotsByDates(all, ["2026-10-08"]);
    expect(home.slots.map(s => s.shipmentId)).toEqual([2]);
  });
});
