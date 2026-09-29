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
  Order_Draft_Id?: number | null;
  Order_Draft_Due_Date?: string | null;
  IsOrderShippingChangeAllowed?: boolean;
}

export interface CartLine {
  Quantity: number;
  ItemQuantityType: number; // 1 = unit, 2 = kg
}

export interface Promotion {
  MivzaId: number;
  MivzaDesc: string;
  MivzaText: string;
}

export interface UnitOption {
  Type: number; // 1 = unit, 2 = kg
  Interval: number;
  ItemUnitTypeDesc: string;
  MaxQuantity: number;
}

// Catalog fields are optional: the cart and order endpoints return the same record, and tests build minimal ones.
export interface Item {
  Id: number;
  BarKod: string;
  Name: string;
  IsInStock: boolean;
  Price_NET: number;
  Cart: CartLine | null;
  ManufacturerName?: string | null;
  CategoryName?: string | null;
  SubCategoryName?: string | null;
  UnitSizeDesc?: string | null;
  PricePerUnitDesc?: string | null;
  Price_Regular?: number | null;
  IsFavorites?: boolean;
  IsRemarks?: boolean;
  Mivza?: Promotion | null;
  ItemQuantityTypes?: { ConversionRate: number; Types: UnitOption[] | null } | null;
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
