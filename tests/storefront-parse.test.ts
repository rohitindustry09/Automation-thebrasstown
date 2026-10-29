import { describe, expect, it } from "vitest";
import { extractQuantityFromHtml } from "../src/lib/storefront-parse";

const page = (body: string, head = "") => `<html><head>${head}</head><body><main>${body}</main></body></html>`;

describe("extractQuantityFromHtml", () => {
  it("reads a theme low-stock widget", () => {
    expect(extractQuantityFromHtml(page("<div class='variant__countdown'>Hurry, Only 3 Left!</div>"))).toBe(3);
  });

  it("reads 'N left in stock' text", () => {
    expect(extractQuantityFromHtml(page("<p>12 left in stock</p>"))).toBe(12);
  });

  it("reads inventory_quantity from embedded JSON", () => {
    const html = page("", `<script type="application/json">{"variants":[{"inventory_quantity":7}]}</script>`);
    expect(extractQuantityFromHtml(html)).toBe(7);
  });

  it("ignores generic quantity keys such as cart line quantity", () => {
    const html = page("", `<script type="application/json">{"cart":{"items":[{"quantity":1}]}}</script>`);
    expect(extractQuantityFromHtml(html)).toBeNull();
  });

  it("ignores text inside script tags", () => {
    expect(extractQuantityFromHtml(page("<script>var s='Only 9 left'</script><p>Nice brass lamp</p>"))).toBeNull();
  });

  it("returns null when nothing is exposed", () => {
    expect(extractQuantityFromHtml(page("<p>In stock</p>"))).toBeNull();
  });
});
