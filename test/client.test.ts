import { describe, expect, it } from "vitest";
import { HaziHinamClient } from "../src/client.js";
import { AuthRequired, ForbiddenOperation, UpstreamError } from "../src/errors.js";
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
});
