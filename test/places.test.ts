import { describe, expect, it } from "vitest";
import { runOp, signedIn } from "./helpers.js";

const address = {
  Id: 4, AddressDescription: "Home", City: "Testville", Street: "Main", Number: "1", Apartment: "2", Floor: "3", Entrance: null,
  IsDefault: true, IsSelfPickUp: false, AddressCoordinatesVerified: true, Latitude: 32.1, Longitude: 34.8,
  GooglePlaceId: "g", Notes: "gate code 1234",
};

describe("addresses", () => {
  it("lists addresses without coordinates, Google data or notes", async () => {
    const { ctx } = await signedIn({ "GET Address/get": { Addresses: [address] } });
    const result = await runOp(ctx, "list_addresses");
    expect(result).toEqual([{
      addressId: 4, label: "Home", city: "Testville", street: "Main", number: "1", apartment: "2", floor: "3",
      isDefault: true, selfPickup: false, verified: true,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/32\.1|gate code|"g"/);
  });

  it("sets the default address with a wrapped empty PUT", async () => {
    const { ctx, calls } = await signedIn({ "PUT address/setDefault/4": null });
    expect(await runOp(ctx, "set_default_address", { addressId: "4" })).toEqual({ addressId: 4, isDefault: true });
    expect(calls[0].body).toEqual({ Object: {} });
  });
});

describe("stores", () => {
  it("lists pickup stores", async () => {
    const { ctx } = await signedIn({ "GET distribution/getStores": { Stores: [{ Id: 70, Name: "Center" }] } });
    expect(await runOp(ctx, "list_pickup_stores")).toEqual([{ storeId: 70, name: "Center" }]);
  });

  it("lists active branches with weekly hours", async () => {
    const day = (name: string, open: boolean) => ({
      DayDescription: name, IsActive: open, IsActiveByCurrentDateTime: false, Notes: "",
      OpenningTimeFrame: open ? { From: { Hour: 7, Minute: 0 }, To: { Hour: 22, Minute: 30 } } : null,
    });
    const branch = {
      Code: 1, IsActive: true, Name: "Center", Address: "1 Main St", Phone: "03-0000000", IsSelfPickUp: true,
      Day_1: day("Sun", true), Day_2: day("Mon", true), Day_3: day("Tue", true), Day_4: day("Wed", true),
      Day_5: day("Thu", true), Day_6: day("Fri", true), Day_7: day("Sat", false),
    };
    const { ctx } = await signedIn({ "GET Branches": { Branches: [branch, { ...branch, Code: 2, IsActive: false }] } });
    const result = (await runOp(ctx, "list_branches")) as any[];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ branchId: 1, name: "Center", address: "1 Main St", phone: "03-0000000", pickup: true });
    expect(result[0].hours[0]).toEqual({ day: "Sun", open: "07:00", close: "22:30" });
    expect(result[0].hours[6]).toEqual({ day: "Sat", closed: true });
  });
});
