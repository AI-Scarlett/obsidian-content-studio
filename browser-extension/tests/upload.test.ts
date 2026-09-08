import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { uploadThroughPicker } from "../src/platforms/upload";

test("cancelling before picker change dispatch prevents upload and restores native methods", async () => {
  const dom = new JSDOM("");
  const win = dom.window as unknown as Window & typeof globalThis;
  const proto = win.HTMLInputElement.prototype;
  const click = Object.getOwnPropertyDescriptor(proto, "click");
  const picker = Object.getOwnPropertyDescriptor(proto, "showPicker");
  const input = win.document.createElement("input");
  input.type = "file";
  Object.defineProperty(input, "files", { writable: true, value: [] });
  Object.defineProperty(win, "DataTransfer", {
    value: class {
      files: File[] = [];
      items = { add: (file: File) => this.files.push(file) };
    },
  });
  let active = true;
  let changes = 0;
  input.onchange = () => changes++;
  try {
    await assert.rejects(uploadThroughPicker(
      win,
      new win.File(["image"], "test.png", { type: "image/png" }),
      () => { input.click(); active = false; },
      100,
      () => active,
    ), /同步已停止/);
    assert.equal(changes, 0);
    assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "click"), click);
    assert.deepEqual(Object.getOwnPropertyDescriptor(proto, "showPicker"), picker);
  } finally {
    dom.window.close();
  }
});
