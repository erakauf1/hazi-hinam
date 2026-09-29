// Shapes observed on the live site (docs/API.md). Only fields this tool reads are listed.

export interface Shipment {
  ShipmentId: number;
  DOW: string;
  Date: string; // dd/MM/yyyy
  Time: { From: string; To: string };
  IsClosedShipment: boolean;
  IsExceeds: boolean;
  IsSelfPickUp: boolean;
}

export interface OrderSummary {
  Id: number;
  Date: string;
  Total: number;
  Order_Status: number;
  Order_Status_Desc: string;
  IsDraftOrder: boolean;
  ShippingTypeDesc: string;
  Shipment: Shipment | null;
}

export interface CartLine {
  Quantity: number;
  ItemQuantityType: number; // 1 = unit, 2 = kg
}

export interface Item {
  Id: number;
  BarKod: string;
  Name: string;
  IsInStock: boolean;
  Price_NET: number;
  Cart: CartLine | null;
}

export interface Category {
  Id: number;
  Name: string;
  Items: Item[] | null;
}

export interface CartSummary {
  Price_NET_TOTAL: number;
  Price_Shipping: number;
  Price_Savings: number;
  Price_Order_Total: number;
  Minimum_Cart_Price_NET: number;
}

export interface ShipmentDay {
  DOW: string;
  Date: string;
  Shipments: Shipment[];
}

export interface DeliveryAddress {
  Id: number;
  Name: string;
  IsDefault: boolean;
  ShipmentsByDate: ShipmentDay[];
}

export interface NextDeliveries {
  Addresses: DeliveryAddress[];
}

export interface UserInfoResults {
  UserInfo: unknown | null;
  CartItemsCount: number;
}
