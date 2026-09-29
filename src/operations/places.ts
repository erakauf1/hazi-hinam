import { z } from "zod";
import { type BranchDay, listAddresses, listBranches, listPickupStores, setDefaultAddress } from "../api/places.js";
import { defineOperation } from "./define.js";

const clock = (t: { Hour: number; Minute: number }) => `${String(t.Hour).padStart(2, "0")}:${String(t.Minute).padStart(2, "0")}`;
const hours = (d: BranchDay) =>
  d.IsActive && d.OpenningTimeFrame
    ? { day: d.DayDescription, open: clock(d.OpenningTimeFrame.From), close: clock(d.OpenningTimeFrame.To) }
    : { day: d.DayDescription, closed: true };

export const listAddressesOp = defineOperation({
  name: "list_addresses",
  description: "List the user's saved delivery addresses (ids are used by list_delivery_slots and change_order_delivery_slot).",
  input: {},
  readOnly: true,
  async run(ctx) {
    return (await listAddresses(await ctx.client())).map(a => ({
      addressId: a.Id,
      label: a.AddressDescription ?? undefined,
      city: a.City ?? undefined,
      street: a.Street ?? undefined,
      number: a.Number ?? undefined,
      apartment: a.Apartment ?? undefined,
      floor: a.Floor ?? undefined,
      isDefault: a.IsDefault,
      selfPickup: a.IsSelfPickUp,
      verified: a.AddressCoordinatesVerified,
    }));
  },
});

export const setDefaultAddressOp = defineOperation({
  name: "set_default_address",
  description: "Make one saved address the user's default delivery address.",
  input: { addressId: z.coerce.number().int().positive() },
  readOnly: false,
  async run(ctx, { addressId }) {
    await setDefaultAddress(await ctx.client(), addressId);
    return { addressId, isDefault: true };
  },
});

export const listPickupStoresOp = defineOperation({
  name: "list_pickup_stores",
  description: "List the stores where an order can be picked up (storeId is used by change_order_delivery_slot).",
  input: {},
  readOnly: true,
  run: async ctx => (await listPickupStores(await ctx.client())).map(s => ({ storeId: s.Id, name: s.Name })),
});

export const listBranchesOp = defineOperation({
  name: "list_branches",
  description: "List the chain's open branches with address, phone, whether pickup is available, and opening hours for each weekday.",
  input: {},
  readOnly: true,
  async run(ctx) {
    return (await listBranches(await ctx.client()))
      .filter(b => b.IsActive)
      .map(b => ({
        branchId: b.Code,
        name: b.Name,
        address: b.Address,
        phone: b.Phone,
        pickup: b.IsSelfPickUp,
        hours: [b.Day_1, b.Day_2, b.Day_3, b.Day_4, b.Day_5, b.Day_6, b.Day_7].map(hours),
      }));
  },
});
