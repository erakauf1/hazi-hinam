import type { HaziHinamClient } from "../client.js";
import { parseSiteDate } from "../dates.js";
import type { NextDeliveries } from "./types.js";

export interface Slot {
  shipmentId: number;
  date: string;
  dayName: string;
  from: string;
  to: string;
  available: boolean;
}

export interface AddressSlots {
  addressId: number;
  name: string;
  isDefault: boolean;
  slots: Slot[];
}

export async function listDeliverySlots(c: HaziHinamClient): Promise<AddressSlots[]> {
  const { Addresses } = await c.get<NextDeliveries>("delivery/getNextDeliveries");
  return Addresses.map(address => ({
    addressId: address.Id,
    name: address.Name,
    isDefault: address.IsDefault,
    slots: address.ShipmentsByDate.flatMap(day =>
      day.Shipments.map(s => ({
        shipmentId: s.ShipmentId,
        date: parseSiteDate(s.Date),
        dayName: day.DOW,
        from: s.Time.From,
        to: s.Time.To,
        available: !s.IsClosedShipment && !s.IsExceeds,
      })),
    ),
  }));
}

export function filterSlotsByDates(addresses: AddressSlots[], dates: string[]): AddressSlots[] {
  const wanted = new Set(dates);
  return addresses.map(a => ({ ...a, slots: a.slots.filter(s => wanted.has(s.date)) }));
}
