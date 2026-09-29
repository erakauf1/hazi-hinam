import { status } from "./account.js";
import { clearCartOp, getCartOp, setCartItemOp } from "./cart.js";
import type { Operation } from "./define.js";
import { listDeliverySlotsOp } from "./delivery.js";
import { copyOrderToCartOp, getOrderItemsOp, listOrdersOp } from "./orders.js";
import { prepareUsualOrderOp, saveUsualOrderOp, showUsualOrderOp } from "./usual-order.js";

export type { Operation } from "./define.js";

// The single list the CLI and the MCP server are generated from. A new capability is one entry here.
export const operations: Operation[] = [
  status,
  listOrdersOp,
  getOrderItemsOp,
  copyOrderToCartOp,
  getCartOp,
  setCartItemOp,
  clearCartOp,
  listDeliverySlotsOp,
  saveUsualOrderOp,
  showUsualOrderOp,
  prepareUsualOrderOp,
];
