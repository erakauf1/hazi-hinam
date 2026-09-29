import { status } from "./account.js";
import { clearCartOp, getCartOp, setCartItemOp } from "./cart.js";
import {
  addFavoriteOp, addShoppingListToCartOp, createShoppingListOp, getShoppingListOp, listFavoritesOp, listShoppingListsOp, removeFavoriteOp,
} from "./lists.js";
import { getPromotionProductsOp, listCategoriesOp, listCategoryProductsOp, listPromotedProductsOp } from "./browse.js";
import { getProductDetailsOp, getProductOp, searchProductsOp, suggestSearchPhrasesOp } from "./catalog.js";
import type { Operation } from "./define.js";
import { listDeliverySlotsOp } from "./delivery.js";
import { listAddressesOp, listBranchesOp, listPickupStoresOp, setDefaultAddressOp } from "./places.js";
import { answerSubstitutionsOp, changeOrderDeliverySlotOp, copyOrderToCartOp, getOrderItemsOp, getSubstitutionsOp, listOrdersOp } from "./orders.js";
import { clearItemRemarkOp, getItemRemarkOptionsOp, setItemRemarkOp } from "./remarks.js";
import { prepareUsualOrderOp, saveUsualOrderOp, showUsualOrderOp } from "./usual-order.js";

export type { Operation } from "./define.js";

// The single list the CLI and the MCP server are generated from. A new capability is one entry here.
export const operations: Operation[] = [
  status,
  searchProductsOp,
  suggestSearchPhrasesOp,
  getProductOp,
  getProductDetailsOp,
  listCategoriesOp,
  listCategoryProductsOp,
  listPromotedProductsOp,
  getPromotionProductsOp,
  listFavoritesOp,
  addFavoriteOp,
  removeFavoriteOp,
  listShoppingListsOp,
  getShoppingListOp,
  createShoppingListOp,
  addShoppingListToCartOp,
  listOrdersOp,
  getOrderItemsOp,
  copyOrderToCartOp,
  changeOrderDeliverySlotOp,
  getSubstitutionsOp,
  answerSubstitutionsOp,
  getCartOp,
  setCartItemOp,
  clearCartOp,
  getItemRemarkOptionsOp,
  setItemRemarkOp,
  clearItemRemarkOp,
  listDeliverySlotsOp,
  listAddressesOp,
  setDefaultAddressOp,
  listPickupStoresOp,
  listBranchesOp,
  saveUsualOrderOp,
  showUsualOrderOp,
  prepareUsualOrderOp,
];
