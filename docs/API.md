# Hazi Hinam shop API — research notes

Source: Angular bundle `https://cdn.hazi-hinam.co.il/app/V_1.3029/main.js` + live logged-out traffic.
Base URL: `https://shop.hazi-hinam.co.il/proxy/api/`. Responses: `{ IsOK, Results, ErrorResponse }`.

## Auth
- `POST Login` body: `{ grant_type: "password", userName, password, captchaToken, client_id: 1 }` → `{ access_token, ... }`
- Login form button is disabled until a **reCAPTCHA** token exists (`constants.RECAPTCHA.KEY`). This is why bots fail.
- Token kept via `userService.setAccessToken(...)`; later requests send `Authorization: Bearer <token>` (to verify: header vs cookie, lifetime, refresh).
- Alt: `POST LoginExtChannel { ExtChannelId, password, username, captchaToken }`
- OTP: `GET user/getOTPToken`, `GET user/sendOTPSMS?OTPToken=`, `POST user/validateConfirmationCode`
- `GET LogOut`, `GET user/info`

## Reorder flow ("copy my previous order for next Thursday")
| Step | Endpoint |
|---|---|
| List past orders | `GET order/history` |
| Items in an order | `GET item/getItemsByOrder/{orderId}` |
| Copy order into cart (native!) | `POST order/addOrderItemsToCart/{orderId}` (or `?draftOrderId=` for drafts) |
| Cart contents / summary | `GET item/getItemsInCart`, `GET order/cartSummary` |
| Delivery slots / checkout data | `GET order/checkout` (to verify slot shape) |
| Next deliveries | `GET delivery/getNextDeliveries` |
| Addresses / stores | `GET Address/get`, `GET distribution/getStores` |
| Create order | `POST order/post` (body TBD — capture live) |
| Change slot on draft | `POST order/ChangeDraftOrderShipping/?Id={draftId}` `{ AddressId, StoreId, ShipmentId }` |
| Draft handling | `POST order/ActivateDraftOrder/?Id=`, `POST order/CancelActiveDraftOrder` |
| Saved cards / payment iframe | `GET user/cc`, `GET user/GetIFrameURL` — **out of scope for MCP** |

## Cart & catalog
- `POST item/addItemToCart`, `POST Item/AddItemsToCart`, `DELETE item/removeItemsInCart`, `PUT item/mergeCartItems/{id}`
- `POST item/getItemsBySearch`, `GET item/getItemByBarkod/{barcode}`, `GET item/{id}`, `GET item/getItemsBySubCategory`, `GET Item/GetItemsByCategory/?Id=`
- `GET Catalog/get`, `GET item/getItemsPromoted`, `GET item/getItemsInMivza/{id}`, `GET item/GetNewItems`, `GET item/getSuggestedItems`
- Favorites: `GET item/getItemsFav`, `POST item/addItemToFavorites`, `DELETE item/RemoveItemFromFavorites/{id}`
- Remarks: `GET item/getItemsRemarks/{id}`, `POST item/saveItemRemarks`, `DELETE item/deleteItemRemarks/{id}`

## Shopping lists
`GET shoppinglist/get`, `GET item/getItemsByShoppingList/{id}`, `POST item/addShoppingListItemsToCart/{id}`, `POST shoppinglist/post`, `PUT shoppinglist/put/{id}`, `DELETE shoppinglist/delete/{id}`, `POST item/addShoppingListItem/?itemId=&shoppingListId=`

## Verified with a live session (2026-09-29)
- `POST /proxy/Login` → `{ access_token (opaque 64-hex), expires_in: 172800 (48h), error }`. No refresh token.
  Token is not in localStorage/sessionStorage or readable cookies → held server-side / HttpOnly by the `/proxy` BFF.
- `GET order/history` → `Results.Orders[]` (newest first): `Id, Date, Total, Order_Status(_Desc), IsDraftOrder,
  IsOrderShippingChangeAllowed, ShippingTypeDesc, Shipment{ ShipmentId, DOW, Date "dd/MM/yyyy", Time{From,To} }`.
- `GET item/getItemsByOrder/{id}` → `Results.OrderItems{ OrderId, AddressId, ShipmentId, IsAllOrderItemsInCart,
  Categories[{ Id, Name, Img, Items[], ItemsCount }] … }` — items grouped by category.
- `GET delivery/getNextDeliveries` → `Addresses[{ Id, IsDefault, Name, ShipmentsByDate[{ DOW, Date, Shipments[] }] }]`
  + `Stores[]` (pickup). Slot: `{ ShipmentId, Time{From,To}, IsClosedShipment, IsExceeds }`. ~12 days ahead.
  **Slot lookup does not need `order/checkout`.**
- `POST order/post` body (from bundle): `{ AddressId | StoreId, ShippmentId (sic), CCToken, KeepCC, PWD, Payments,
  OrderRemarkId, ShipmentRemarkFreeText, ShipmentRemarkId, Acknowledgments }` → **this call is payment**.
  MCP must stop before it.

## Request conventions (required, from `ApiService` in the bundle)
- Headers: `Authorization: Bearer <access_token>`,
  `DEVICE_INFO: {"DEVICE_TYPE": 4, "UDID": "", "MANUFACTURER": "", "MODEL": "", "VERSION": ""}`,
  `Content-Type: application/json; charset=utf-8`.
- **Every POST/PUT body is wrapped: `{"Object": <payload>}`** (empty → `{"Object":{}}`). A bare/empty body → HTTP 500, empty response.

## Live tests (2026-09-29)
1. ✅ Bearer token works from curl (outside the browser): `user/info` logged in, `order/history` returned the full history. No cookie needed.
2. ✅ `POST order/addOrderItemsToCart/{orderId}` with `{"Object":{}}` → `{IsOK:true, Results:null}`. Every product line landed
   in the cart. Response does **not** list skipped items → diff `getItemsByOrder` vs `getItemsInCart` by `Id`.
3. ⚠️ Cart total far below the original order total. Quantities in cart look like **defaults**
   (1 per unit item, the minimum step per weighed item). `getItemsByOrder` items' `Cart` field mirrors the *current* cart, not the
   original order → original quantities not yet found in any endpoint. Candidate: `order/DownloadInvoice/{id}`.

4. ❌ Site shopping lists do **not** store quantities: `item/getItemsByShoppingList/{id}` → `ShoppingListItems`, items carry
   only `ItemQuantityTypes` (allowed units), and `item/addShoppingListItem` takes only `itemId`+`shoppingListId`.

## Decision: "usual order" lives in the MCP, not on the site
- Snapshot: `GET item/getItemsInCart` → per item `Id`, `Cart.Quantity`, `Cart.ItemQuantityType` (1 = unit, 2 = kg) → local `usual-order.json`.
- Replay: `POST item/addItemToCart {"Object":{ ItemId, Quantity, Type, IsCalculateCart }}` per item
  (`IsCalculateCart:false` for all but the last). To verify: sets absolute quantity vs increments.
- Bulk `POST Item/AddItemsToCart {"Object":{ ItemIds:[…] }}` exists but takes no quantities.

- ✅ `item/addItemToCart` **sets** the quantity (absolute). From `updateProductInCart` in the bundle: `Quantity: 0` deletes
  the line, and the UI's +/- buttons send the new total. Replay is idempotent; still empty the cart first so nothing
  outside the usual order sneaks in.
- With `IsCalculateCart:true` the response carries `Results.CalculatedCartItem{ Price_Regular, Price_NET }`.
- Snapshot lives outside the repo: `~/.config/hazi-hinam/usual-order.json`.
2. Is there a way to reserve a slot before payment (draft order), or is the slot only chosen at `order/post`?
