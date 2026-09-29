import { describe, expect, it } from "vitest";
import { runOp, signedIn } from "./helpers.js";

const single = {
  ItemRemarks: {
    IsFreeRemark: true, IsFixRemark: true, FreeRemarkText: null, MultiSelectRemarks: null,
    SingleSelectRemarks: [{ Id: 1, Name: "Ripe", IsSelected: false }, { Id: 2, Name: "Green", IsSelected: true }],
  },
};
const multi = {
  ItemRemarks: {
    IsFreeRemark: false, IsFixRemark: true, FreeRemarkText: null, SingleSelectRemarks: null,
    MultiSelectRemarks: [{ Id: 5, Name: "Sliced", IsSelected: false }, { Id: 6, Name: "Skinless", IsSelected: false }],
  },
};

describe("get_item_remark_options", () => {
  it("describes the choices a product offers", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsRemarks/9": single });
    expect(await runOp(ctx, "get_item_remark_options", { itemId: "9" })).toEqual({
      itemId: 9, freeText: { allowed: true, current: null }, choice: "single",
      options: [{ optionId: 1, name: "Ripe", selected: false }, { optionId: 2, name: "Green", selected: true }],
    });
  });
});

describe("set_item_remark", () => {
  it("sends a single choice as SingleRemarkId", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": single, "POST item/saveItemRemarks": null });
    await runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "1", text: "not too soft" });
    expect(calls[1].body).toEqual({ Object: { ItemId: 9, OrderId: null, FreeRemarkText: "not too soft", MultiRemarkIds: [], SingleRemarkId: 1 } });
  });

  it("sends several choices as MultiRemarkIds", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": multi, "POST item/saveItemRemarks": null });
    await runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "5,6" });
    expect(calls[1].body).toEqual({ Object: { ItemId: 9, OrderId: null, FreeRemarkText: null, MultiRemarkIds: [5, 6], SingleRemarkId: null } });
  });

  it("rejects options the product does not offer, and two options for a single choice", async () => {
    const { ctx, calls } = await signedIn({ "GET item/getItemsRemarks/9": single, "POST item/saveItemRemarks": null });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "7" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", optionIds: "1,2" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    expect(calls.filter(c => c.method === "POST")).toHaveLength(0);
  });

  it("rejects free text when the product does not accept it, and an empty remark", async () => {
    const { ctx } = await signedIn({ "GET item/getItemsRemarks/9": multi });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9", text: "hello" })).rejects.toMatchObject({ code: "BAD_INPUT" });
    await expect(runOp(ctx, "set_item_remark", { itemId: "9" })).rejects.toMatchObject({ code: "BAD_INPUT" });
  });
});

describe("clear_item_remark", () => {
  it("deletes the remark", async () => {
    const { ctx, calls } = await signedIn({ "DELETE item/deleteItemRemarks/9": null });
    expect(await runOp(ctx, "clear_item_remark", { itemId: "9" })).toEqual({ itemId: 9, cleared: true });
    expect(calls[0].method).toBe("DELETE");
  });
});
