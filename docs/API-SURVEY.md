# Hazi Hinam API survey

Complete map of the store's API, as used by its own web app (Angular bundle `V_1.3029`: `main.js` plus 6 lazily
loaded chunks). Each endpoint was extracted from the app's code; every endpoint without side effects was also
called live with a signed-in account (2026-09-29) and its response **structure** recorded. No personal values are
kept here.

- Base URL: `https://shop.hazi-hinam.co.il/proxy/api/` (login and `init` live one level up, under `/proxy/`).
- Conventions (headers, `{"Object": …}` wrapping, envelope): see [API.md](API.md).
- **Wrapping:** POST/PUT bodies are wrapped as `{"Object": body}` unless marked **unwrapped**. Unwrapped calls send
  their own top-level body (search sends `{Paging, Object}`).

## Summary

| | Count |
|---|---|
| Endpoints in the app | 98 |
| Probed live (read-only) | 49 |
| Built in phase 1 (v1) | 9 |
| Built in phase 2 (v2) | 26 |
| Recommended next | 3 |
| Later / nice to have | 34 |
| Excluded | 26 |

**Risk classes:** `read` (no side effects) · `cart` (changes cart or an open order) · `account` (changes saved
account data) · `message` (sends something to the store) · `auth` (login/SMS/registration) · `payment` ·
`destructive-account`.

**MCP recommendation:** `v1` built in phase 1 · `v2` built in phase 2 · `next` still recommended · `later` if needed · `exclude` never exposed to an
assistant (credentials, CAPTCHA, SMS, account deletion, payment for now, marketing content).

## Session

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `init` | GET |  | read | later | 200 | AnonymousToken, ClientConfigurations, ServerConfigurations | Site configuration and UI texts; `AnonymousToken` for guest carts. |
| `Login` | POST | raw | auth | exclude | not probed |  | Password login; needs a reCAPTCHA token. The user logs in themselves. |
| `LoginExtChannel` | POST | raw | auth | exclude | not probed |  | Login for external channels; also needs a CAPTCHA token. |
| `LogOut` | GET |  | auth | next | not probed |  | Ends the session on the server. Useful for `hazi-hinam logout`. |
| `SUBMITLOGIN` | POST | raw | auth | exclude | not probed |  | Posts a bearer token to a login URL (SSO handoff). |

## Account

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `general/phoneprfs` | GET |  | read | later | 200 | phone_prfs, extra_phone_prfs | Phone prefixes for forms. |
| `register` | POST | wrapped | account | exclude | not probed |  | Account creation. |
| `UnRegister` | POST | wrapped | destructive-account | exclude | not probed |  | Deletes the account. |
| `user/activate` | POST | wrapped | auth | exclude | not probed |  | Email activation during registration. |
| `user/changePassword` | PUT | wrapped | account | exclude | not probed |  | Credential change: user does it on the site. |
| `user/getOTPToken` | GET |  | auth | exclude | not probed |  | Password-reset OTP flow. |
| `user/getRegistrationToken` | GET |  | auth | exclude | not probed |  | Registration flow. |
| `user/info` | GET |  | read | v1 | 200 | IsShipment, IsCart, CartItemsCount, UserInfo, Shipment, IsAnonymousCart, IsMustChangePassword, DraftOrderInfo, … | Signed-in check, cart count, next delivery, draft-order state. |
| `user/sendOTPSMS` | GET |  | auth | exclude | not probed |  | Sends an SMS. |
| `user/sendVerificationSMS` | POST | wrapped | auth | exclude | not probed |  | Registration SMS. |
| `user/SetUserNotificatioRead` | PUT | wrapped | account | later | not probed |  | Marks site notifications read (sic: Notificatio). |
| `User/Update` | PUT | wrapped | account | later | not probed |  | Updates name/phone/marketing consent. |
| `user/validateConfirmationCode` | POST | wrapped | auth | exclude | not probed |  | Registration code check. |

## Addresses

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `address/delete` | DELETE |  | account | later | not probed |  | Delete an address. |
| `Address/get` | GET |  | read | v2 | 200 | AtleaseOneAddressCoordinatesUnVerified, AtleaseOneAddressCoordinatesUnVerifiedMessage, Addresses | Saved delivery addresses (full address fields). |
| `address/post` | POST | wrapped | account | later | not probed |  | Add an address; body `{UserAddresses:{IsSelfPickUp,IsDefault,Address}}`. |
| `Address/put` | PUT | wrapped | account | later | not probed |  | Edit an address. |
| `address/setDefault` | PUT | wrapped | account | v2 | not probed |  | Choose the default delivery address. |
| `address/validateGooglePlaceId` | POST | wrapped | read | later | not probed |  | Validates a Google Place id. |
| `distribution/getCities` | GET |  | read | later | 200 | Cities | Cities served. |
| `distribution/getStores` | GET |  | read | v2 | 200 | Stores | Pickup stores. |
| `distribution/getStreetsByCity` | GET |  | read | later | 200 | Streets | Streets for a city (`?Id=`). |

## Catalog

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `Catalog/get` | GET |  | read | v2 | 200 | Campaign, Categories | Category tree plus current campaign. |
| `item/{id}` | GET |  | read | v2 | 200 | Item | One product. |
| `item/getItemByBarkod/{barcode}` | GET |  | read | v2 | 200 | Item | Look up by barcode; fallback when a saved item id is retired. |
| `item/GetItemGS1Details/{id}` | GET |  | read | v2 | 200 | ItemId, Barcode, IngredientSequenceandName, ShortDescription, Remarks, ManufacturerName, ManufacturerAddress, UsageAndSafetyWarnings, … | Ingredients, nutrition, allergens, origin. |
| `item/GetItemImages/{id}` | GET |  | read | later | 200 | ItemId, Images, Images360 | Product images. |
| `Item/GetItemsByCategory` | GET |  | read | next | 200 | SubCategories | Items in a category. |
| `item/getItemsBySearch` | POST | **unwrapped** | read | v2 | 200 | Items, Categories, SearchPhrases, SuggestedSearchCategories | Product search. **Unwrapped** body `{Paging:{Page,PageSize},Object:{SearchPhrase,SearchPhrases,ItemGroupping}}`. |
| `item/getItemsBySubCategory` | GET |  | read | v2 | 200 | Category, Filters, Sorts | Items in a sub-category; query `Id, SortBy, IsDescending, filter[FILTER_Mivza], filter[FILTER_Manufacturer]`. |
| `item/GetNewItems` | GET |  | read | later | 200 | NewItems | New products. |
| `item/GetRegulatedItems` | GET |  | read | later | 200 | array | Price-regulated products. |
| `item/getSuggestedItems` | GET |  | read | later | 200 | SuggestedItems | Suggestions for this customer. |
| `item/GetSuggestedSearchPhrases` | GET |  | read | v2 | 200 | SuggestedSearchPhrases | Autocomplete (`?searchPhrase=`). |

## Promotions

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `Item/GetCampaignItems` | GET |  | read | later | 200 | Campaign | Current campaign items. |
| `item/getItemsByTags/{ids}` | GET |  | read | later | 200 | Tags, Id, Name | Items for tag ids (comma-separated). |
| `item/getItemsInMivza/{id}` | GET |  | read | v2 | not probed |  | Products in one promotion (mivza). |
| `item/getItemsPromoted` | GET |  | read | v2 | 200 | PromotedItems | Promoted products (`?SortBy=`). |
| `tag/get` | GET |  | read | later | 200 | Tags | Tags. |
| `tag/GetSpecialCategories` | POST | wrapped | read | later | 200 | MainTitle, SpecialCategories | Special categories `{IsPromoted,id}`. |

## Cart

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `Item/AddItemsToCart` | POST | wrapped | cart | later | not probed |  | Add many items by id, default amounts `{ItemIds:[…]}`. |
| `item/addItemToCart` | POST | wrapped | cart | v1 | not probed |  | Set one line's quantity (absolute; 0 removes). |
| `Item/AddTagItemsToCart` | POST | **unwrapped** | cart | later | not probed |  | Add a tag's items. **Unwrapped** empty body. |
| `item/deleteItemRemarks/{id}` | DELETE |  | cart | v2 | not probed |  | Remove a remark. |
| `item/getItemsInCart` | GET |  | read | v1 | 200 | CartItemsCount, CartItems, Sorts | Cart items (query `SortBy, IsDescending`). |
| `item/getItemsRemarks/{id}` | GET |  | read | v2 | 200 | ItemRemarks | Per-item remark options (e.g. ripeness, slicing). |
| `item/mergeCartItems/{id}` | PUT | wrapped | cart | later | not probed |  | Merge a guest cart into the account. |
| `item/removeItemsInCart` | DELETE |  | cart | v1 | not probed |  | Empty the cart. |
| `item/saveItemRemarks` | POST | wrapped | cart | v2 | not probed |  | Save a remark `{ItemId,OrderId,FreeRemarkText,MultiRemarkIds,SingleRemarkId}`. |
| `order/cartSummary` | GET |  | read | v1 | 200 | CartSummary | Totals, delivery fee, minimum order. |

## Favorites

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `item/addItemToFavorites` | POST | wrapped | account | v2 | not probed |  | `{ItemId,Quantity,Type}`. |
| `item/getItemsFav` | GET |  | read | v2 | 200 | FavoriteItems | Favorite products. |
| `item/RemoveItemFromFavorites/{id}` | DELETE |  | account | v2 | not probed |  | Remove a favorite. |

## Shopping lists

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `item/addShoppingListItem` | POST | wrapped | account | later | not probed |  | Add an item to a list (query params). |
| `item/addShoppingListItemsToCart/{id}` | POST | **unwrapped** | cart | v2 | not probed |  | Add a whole list to the cart. **Unwrapped** empty body. |
| `item/getItemsByShoppingList/{id}` | GET |  | read | v2 | 200 | ShoppingListItems | Items in a list. |
| `item/removeShoppingListItem` | DELETE |  | account | later | not probed |  | Remove an item from a list (query params). |
| `shoppinglist/delete/{id}` | DELETE |  | account | later | not probed |  | Delete a list. |
| `shoppinglist/get` | GET |  | read | v2 | 200 | IsFavorites, FavoritesCount, ShoppingList | Saved lists (no quantities). |
| `shoppinglist/getItemLists/{id}` | GET |  | read | later | 404 | (non-JSON, 0 bytes) | Returned 404 when called with an item id; parameter meaning unconfirmed. |
| `shoppinglist/getItemListsExistance` | GET |  | read | later | 200 | ShoppingListItemExistance | Which lists contain an item (`?Id=`). |
| `shoppinglist/post` | POST | wrapped | account | v2 | not probed |  | Create a list `{Name,OrderId,Order_Draft_Id}` (can seed from an order). |
| `shoppinglist/put/{id}` | PUT | wrapped | account | later | not probed |  | Rename `{Name}`. |

## Orders

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `item/getItemsByOrder/{id}` | GET |  | read | v1 | 200 | OrderItems | Items of an order, by category (no original quantities). |
| `order/ActivateDraftOrder` | POST | wrapped | cart | later | not probed |  | Open a placed order for editing (`?Id=`). |
| `order/addOrderItemsToCart` | POST | wrapped | cart | v1 | tested earlier (writes) |  | Site reorder (default amounts). `/{orderId}` or `?draftOrderId=`. |
| `order/CancelActiveDraftOrder` | POST | wrapped | cart | later | not probed |  | Cancel editing an open order. |
| `order/ChangeDraftOrderShipping` | POST | wrapped | cart | v2 | not probed |  | Change the slot of an editable order `{AddressId,StoreId,ShipmentId}`. |
| `order/DownloadInvoice/{id}` | GET (file) |  | read | next | 404 | (non-JSON, 0 bytes) | Invoice PDF; 404 for the probed id (may need `ComaxId` or a finished order). |
| `order/history` | GET |  | read | v1 | 200 | Orders | All past orders. |
| `SSCS/GetOrderSuggestedAlternativeItems/{id}` | GET |  | read | v2 | 200 (IsOK false) | IsOK, Results, ErrorResponse | Substitutes for missing items; returned an error for a finished order. |
| `SSCS/SetOrderAlternativeItems` | POST | **unwrapped** | cart | v2 | not probed |  | Choose substitutes (`?Id=`). **Unwrapped** body. |

## Checkout

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `order/checkout` | GET |  | read | later | 200 | MaxCCs, MaxPayments, CC_Iframe_URL, ShipmentRemarks, OrderRemarks, OrderAcknowledgments, Addresses, Stores, … | Checkout data: slots, remarks, acknowledgments, card-iframe URL, user details. |
| `order/post` | POST | wrapped | payment | exclude | not probed |  | Places and pays for the order. Out of scope for this version. |

## Delivery

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `delivery/getNextDeliveries` | GET |  | read | v1 | 200 | AvailableAddressShipments, AvailableStoreshipments, Addresses, Stores | Slots per address and store, ~12 days ahead. |

## Payment

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `user/cc` | GET |  | payment | exclude | not probed |  | Saved cards (list/delete). Blocked by the client. |
| `user/GetIFrameURL` | GET |  | payment | exclude | not probed |  | Card-entry iframe. Blocked by the client. |

## Site content

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `CMS/Banners` | GET |  | read | exclude | 200 | array | Marketing banners. |
| `CMS/DynamicContent` | GET |  | read | exclude | 200 | IsOK, Results, ErrorResponse | CMS page blocks. |
| `CMS/DynamicContents` | POST | wrapped | read | exclude | 200 | array | CMS page blocks (POST read). |
| `CMS/DynamicContentsTags` | GET |  | read | exclude | 200 | array | CMS tags. |
| `CMS/GetOperationalMessages` | GET |  | read | later | 200 | array | Site-wide notices (e.g. holiday hours). |
| `contact/info` | GET |  | read | later | 200 | ContactUs, Subjects | Customer-service contact details. |
| `contact/post` | POST | wrapped | message | exclude | not probed |  | Sends a message to customer service. |
| `General/GetAccessibility/1` | GET |  | read | exclude | 200 | UpdatedOn, InnerHtmlRegulationsContent | Accessibility statement. |
| `General/GetPrivacy/1` | GET |  | read | exclude | 200 | UpdatedOn, InnerHtmlRegulationsContent | Privacy policy. |
| `General/GetRegulations/1` | GET |  | read | later | 200 | UpdatedOn, InnerHtmlRegulationsContent | Terms of use (delivery/return rules). |
| `Jobs/Apply` | POST | wrapped | message | exclude | not probed |  | Job application. |
| `Jobs/Job/{id}` | GET |  | read | exclude | not probed |  | One job. |
| `Jobs/Jobs` | GET |  | read | exclude | 200 | Jobs | Job openings. |
| `shortLinks` | POST | **unwrapped** | read | exclude | not probed |  | Google Firebase short links (external service). |

## Stores

| Endpoint | Method | Body | Risk | MCP | Live | Response (top-level) | Notes |
|---|---|---|---|---|---|---|---|
| `Branches` | GET |  | read | v2 | 200 | StripImageFullPath, Branches | Branches with address, hours per weekday, pickup flag. |
| `Branches/Branch/{id}` | GET |  | read | later | not probed |  | One branch. |

## Findings from the survey

- **Search works** with the unwrapped body above and returns full product records (price, unit, stock, promotion, cart line).
- **Product details** (`GetItemGS1Details`) include ingredients, nutrition per 100 g, allergens and country of origin, which is useful for dietary questions.
- **Substitutions** (`SSCS/*`) exist for missing items. The probe of a finished order was rejected; it probably applies only to open orders.
- **Editable orders:** `ActivateDraftOrder` → change items/slot → `ChangeDraftOrderShipping`. This lets an assistant change an order that was already placed, until its cutoff time (`OrderDraftDueDate`).
- **`order/checkout`** carries the card-iframe URL and the user's personal details; the MCP should not expose it raw.
- **Shopping lists can be seeded from an order** (`shoppinglist/post {Name, OrderId}`), but still without quantities.
- `shoppinglist/getItemLists/{id}` returned 404 and `order/DownloadInvoice/{id}` returned 404 for the ids tried; both need a follow-up.
- **Deferred from phase 2:** `LogOut` lives under `/proxy/`, outside the client's allowed base path; `Item/GetItemsByCategory` is covered by sub-category browsing (`item/getItemsBySubCategory`); `order/DownloadInvoice/{id}` returned 404 in the survey and is a file download.
- The site's API name has typos that must be kept as-is: `getItemByBarkod`, `SetUserNotificatioRead`, `ItemGroupping`, `ShippmentId` (in `order/post`), `getItemListsExistance`.
