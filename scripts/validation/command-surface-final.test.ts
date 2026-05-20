import { expect, test } from "bun:test";
import { existsSync } from "node:fs";

test("generated projects do not ship a default README command surface", () => {
  expect(existsSync("templates/README.md.tpl")).toBe(false);
});
