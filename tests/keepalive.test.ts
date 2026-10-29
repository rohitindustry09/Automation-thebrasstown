import { describe, expect, it } from "vitest";
import { resolveKeepAliveTarget } from "../src/lib/keepalive";

describe("resolveKeepAliveTarget", () => {
  it("reads APP_URL and accepts a bare domain", () => {
    expect(resolveKeepAliveTarget({ APP_URL: "my-app.onrender.com" })?.href).toBe("https://my-app.onrender.com/api/health");
  });
  it("accepts a full URL and ignores a trailing slash or path", () => {
    expect(resolveKeepAliveTarget({ APP_URL: "https://my-app.onrender.com/" })?.href).toBe("https://my-app.onrender.com/api/health");
    expect(resolveKeepAliveTarget({ APP_URL: "https://my-app.onrender.com/dashboard" })?.href).toBe("https://my-app.onrender.com/api/health");
  });
  it("prefers APP_URL, then KEEP_ALIVE_URL, then Render's own RENDER_EXTERNAL_URL", () => {
    expect(resolveKeepAliveTarget({ APP_URL: "a.com", KEEP_ALIVE_URL: "b.com", RENDER_EXTERNAL_URL: "https://c.com" })?.host).toBe("a.com");
    expect(resolveKeepAliveTarget({ KEEP_ALIVE_URL: "b.com", RENDER_EXTERNAL_URL: "https://c.com" })?.host).toBe("b.com");
    expect(resolveKeepAliveTarget({ RENDER_EXTERNAL_URL: "https://c.com" })?.host).toBe("c.com");
  });
  it("does nothing when no URL is configured or the value is invalid", () => {
    expect(resolveKeepAliveTarget({})).toBeNull();
    expect(resolveKeepAliveTarget({ APP_URL: "not a url" })).toBeNull();
  });
});
