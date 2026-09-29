import { describe, expect, it } from "vitest";
import { HaziHinamClient } from "../src/client.js";
import { AuthRequired, ForbiddenOperation, HaziHinamError, UpstreamError } from "../src/errors.js";
import { fakeFetch } from "./helpers.js";

describe("HaziHinamClient", () => {
  it("sends the headers the site's own app sends", async () => {
    const f = fakeFetch({ "GET user/info": { CartItemsCount: 0 } });
    await new HaziHinamClient("tok", { fetch: f.fetch }).get("user/info");
    const h = f.calls[0].headers;
    expect(h.get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(h.get("device_info")!)).toEqual({ DEVICE_TYPE: 4, UDID: "", MANUFACTURER: "", MODEL: "", VERSION: "" });
    expect(h.get("user-agent")).toBe("Mozilla/5.0");
  });

  it("returns Results and passes query parameters", async () => {
    const f = fakeFetch({ "GET item/getItemsPromoted": { Items: [1] } });
    const results = await new HaziHinamClient("t", { fetch: f.fetch }).get("item/getItemsPromoted", { SortBy: -1 });
    expect(results).toEqual({ Items: [1] });
    expect(f.calls[0].url.searchParams.get("SortBy")).toBe("-1");
  });

  it("wraps POST bodies in {Object}", async () => {
    const f = fakeFetch({ "POST item/addItemToCart": null, "POST order/addOrderItemsToCart/5": null });
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await c.post("item/addItemToCart", { ItemId: 1 });
    await c.post("order/addOrderItemsToCart/5");
    expect(f.calls[0].body).toEqual({ Object: { ItemId: 1 } });
    expect(f.calls[1].body).toEqual({ Object: {} });
    expect(f.calls[0].headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("maps 401 to AuthRequired", async () => {
    const f = fakeFetch({ "GET user/info": () => ({ status: 401, text: "" }) });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).get("user/info")).rejects.toBeInstanceOf(AuthRequired);
  });

  it("reports HTTP errors and non-JSON bodies as UpstreamError", async () => {
    const f = fakeFetch({
      "POST order/addOrderItemsToCart/1": () => ({ status: 500, text: "" }),
      "GET order/history": () => ({ status: 200, text: "<html>" }),
    });
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await expect(c.post("order/addOrderItemsToCart/1")).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 500 });
    await expect(c.get("order/history")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("surfaces the site's rejection reason when IsOK is false", async () => {
    const f = fakeFetch({
      "POST item/addItemToCart": () => ({ json: { IsOK: false, Results: null, ErrorResponse: { ErrorDescription: "Item not available" } } }),
    });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).post("item/addItemToCart", {})).rejects.toThrow(/Item not available/);
  });

  it.each(["order/post", "/order/post", "user/cc", "user/cc/12", "user/GetIFrameURL"])(
    "refuses %s without touching the network",
    async path => {
      const f = fakeFetch({});
      await expect(new HaziHinamClient("t", { fetch: f.fetch }).post(path, {})).rejects.toBeInstanceOf(ForbiddenOperation);
      expect(f.calls).toHaveLength(0);
    },
  );

  it.each(["foo/../order/post", "./user/cc", "user/./cc/1"])("refuses %s after path normalization", async path => {
    const f = fakeFetch({});
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).post(path, {})).rejects.toBeInstanceOf(ForbiddenOperation);
    expect(f.calls).toHaveLength(0);
  });

  it.each(["https://evil.example/x", "../../other"])("refuses %s, which would leave the API, without sending the token", async path => {
    const f = fakeFetch({});
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).get(path)).rejects.toMatchObject({ code: "BAD_PATH" });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).get(path)).rejects.toBeInstanceOf(HaziHinamError);
    expect(f.calls).toHaveLength(0);
  });

  it("reports a JSON null body as UpstreamError", async () => {
    const f = fakeFetch({ "GET user/info": () => ({ status: 200, text: "null" }) });
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).get("user/info")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("sends DELETE and returns Results", async () => {
    const f = fakeFetch({ "DELETE order/draft/3": { Removed: true } });
    const results = await new HaziHinamClient("t", { fetch: f.fetch }).delete("order/draft/3");
    expect(results).toEqual({ Removed: true });
    expect(f.calls[0].method).toBe("DELETE");
  });

  it.each(["order/%70ost", "order%2Fpost", "user/%63c", "order/%E0%A4%A"])("refuses %s without calling the network", async path => {
    const f = fakeFetch({});
    await expect(new HaziHinamClient("t", { fetch: f.fetch }).post(path)).rejects.toBeInstanceOf(HaziHinamError);
    expect(f.calls).toHaveLength(0);
  });

  it("still allows an ordinary path", async () => {
    const f = fakeFetch({ "GET item/getItemsInCart": {} });
    await new HaziHinamClient("t", { fetch: f.fetch }).get("item/getItemsInCart");
    expect(f.calls).toHaveLength(1);
  });
});

describe("HaziHinamClient POST options and PUT", () => {
  it("sends an unwrapped body when wrap is false", async () => {
    const f = fakeFetch({ "POST item/getItemsBySearch": { Items: [] } });
    const body = { Paging: { Page: 1, PageSize: 20 }, Object: { SearchPhrase: "milk" } };
    await new HaziHinamClient("t", { fetch: f.fetch }).post("item/getItemsBySearch", body, { wrap: false });
    expect(f.calls[0].body).toEqual(body);
  });

  it("adds query parameters to a POST", async () => {
    const f = fakeFetch({ "POST order/ChangeDraftOrderShipping/": null });
    await new HaziHinamClient("t", { fetch: f.fetch }).post("order/ChangeDraftOrderShipping/", { ShipmentId: 3 }, { query: { Id: 77 } });
    expect(f.calls[0].url.searchParams.get("Id")).toBe("77");
    expect(f.calls[0].body).toEqual({ Object: { ShipmentId: 3 } });
  });

  it("wraps PUT bodies, including an empty one", async () => {
    const f = fakeFetch({ "PUT address/setDefault/4": null });
    await new HaziHinamClient("t", { fetch: f.fetch }).put("address/setDefault/4");
    expect(f.calls[0].method).toBe("PUT");
    expect(f.calls[0].body).toEqual({ Object: {} });
  });

  it("still refuses payment paths for unwrapped POST and PUT", async () => {
    const f = fakeFetch({});
    const c = new HaziHinamClient("t", { fetch: f.fetch });
    await expect(c.post("order/post", {}, { wrap: false })).rejects.toBeInstanceOf(ForbiddenOperation);
    await expect(c.put("user/cc")).rejects.toBeInstanceOf(ForbiddenOperation);
    expect(f.calls).toHaveLength(0);
  });
});
