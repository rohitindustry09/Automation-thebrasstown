import { describe, expect, it } from "vitest";
import { mayContainQuantity, extractQuantityFromHtml, isBackorderPage } from "../src/lib/storefront-parse";

const page = (body: string, head = "") => `<html><head>${head}</head><body><main>${body}</main></body></html>`;

describe("isBackorderPage", () => {
  const notice = `<div class="bhunes-announcement-box"><span class="bhunes-backorder-title">Production Update</span>
    <p class="bhunes-backorder-message">This product is currently on <strong>backorder</strong> and is in production.</p></div>`;
  const css = "<style>.bhunes-backorder-title{font-size:14px}.bhunes-backorder-message{margin:0}</style>";

  it("detects the store's production-update notice", () => {
    expect(isBackorderPage(page(notice, css))).toBe(true);
  });
  it("detects 'currently on backorder' wording without the theme's classes", () => {
    expect(isBackorderPage(page("<p>This item is currently on <b>back-order</b>.</p>"))).toBe(true);
  });
  it("is not fooled by the notice's CSS rule on a normal in-stock page", () => {
    expect(isBackorderPage(page("<p>In stock, ships today</p>", css))).toBe(false);
  });
  it("is not fooled by 'Backorder' in a script (filter labels)", () => {
    expect(isBackorderPage(page("<p>ok</p><script>var AV={'Backorder':'Made to order'};</script>"))).toBe(false);
  });
  it("is false for a plain page", () => {
    expect(isBackorderPage(page("<p>Only 3 left</p>"))).toBe(false);
  });
});

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

  it("cheap pre-check never rejects a page that holds a count (tags and nbsp between the words)", () => {
    for (const body of [
      "<span>Hurry, Only 3 Left!</span>",
      "<p>Only <b>3</b> left</p>",
      "<p>Only&nbsp;3&nbsp;left</p>",
      "<p><b>4</b> items left in stock</p>",
      "<p>12 in stock</p>",
      '<script type="application/json">{"inventory_quantity":5}</script>',
    ]) {
      expect(mayContainQuantity(page(body))).toBe(true);
    }
  });

  it("cheap pre-check skips a page with no stock wording at all", () => {
    expect(mayContainQuantity(page("<p>Handmade brass lamp. Ships in 3 days.</p>", "<style>.a{text-align:left}</style>"))).toBe(false);
  });

  it("ignores a count that sits next to another product's SKU", () => {
    const html = page(
      "",
      `<script type="application/json">{"related":[{"sku":"OTHER-1","inventory_quantity":2}],"variants":[{"sku":"MINE-1","inventory_quantity":5}]}</script>`,
    );
    expect(extractQuantityFromHtml(html, { sku: "mine-1" })).toBe(5);
    const onlyOther = page("", `<script type="application/json">{"related":[{"sku":"OTHER-1","inventory_quantity":2}]}</script>`);
    expect(extractQuantityFromHtml(onlyOther, { sku: "MINE-1" })).toBeNull();
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
