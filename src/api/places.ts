import type { HaziHinamClient } from "../client.js";

export interface Address {
  Id: number;
  AddressDescription: string | null;
  City: string | null;
  Street: string | null;
  Number: string | null;
  Apartment: string | null;
  Floor: string | null;
  IsDefault: boolean;
  IsSelfPickUp: boolean;
  AddressCoordinatesVerified: boolean;
}

export async function listAddresses(c: HaziHinamClient): Promise<Address[]> {
  return (await c.get<{ Addresses: Address[] | null }>("Address/get")).Addresses ?? [];
}

export async function setDefaultAddress(c: HaziHinamClient, addressId: number): Promise<void> {
  await c.put(`address/setDefault/${addressId}`);
}

export async function listPickupStores(c: HaziHinamClient): Promise<{ Id: number; Name: string }[]> {
  return (await c.get<{ Stores: { Id: number; Name: string }[] | null }>("distribution/getStores")).Stores ?? [];
}

interface Clock { Hour: number; Minute: number }

export interface BranchDay {
  DayDescription: string;
  IsActive: boolean;
  OpenningTimeFrame: { From: Clock; To: Clock } | null;
}

export interface Branch {
  Code: number;
  IsActive: boolean;
  Name: string;
  Address: string;
  Phone: string;
  IsSelfPickUp: boolean;
  Day_1: BranchDay; Day_2: BranchDay; Day_3: BranchDay; Day_4: BranchDay; Day_5: BranchDay; Day_6: BranchDay; Day_7: BranchDay;
}

export async function listBranches(c: HaziHinamClient): Promise<Branch[]> {
  return (await c.get<{ Branches: Branch[] | null }>("Branches")).Branches ?? [];
}
