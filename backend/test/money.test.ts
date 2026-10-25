import assert from "node:assert/strict";
import test from "node:test";
import { parseMoney } from "../src/lib/money.js";

test("aceita salário com milhar e com centavos", () => {
  assert.equal(parseMoney("2,000"), 2000);
  assert.equal(parseMoney("2.000"), 2000);
  assert.equal(parseMoney("2.000,50"), 2000.5);
  assert.equal(parseMoney("1800,00"), 1800);
  assert.equal(parseMoney("2,50"), 2.5);
});
