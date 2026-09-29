import { describe, expect, it } from "vitest";
import { extractToken } from "../src/browser-login.js";

describe("extractToken", () => {
  it("reads access_token from the site's login response", () => {
    expect(extractToken({ access_token: "abc", expires_in: 172800, error: null })).toBe("abc");
  });

  it.each([null, {}, { access_token: "" }, { access_token: null, error: "invalid_grant" }])("rejects %j", body => {
    expect(() => extractToken(body)).toThrow(/did not contain an access token/);
  });
});
