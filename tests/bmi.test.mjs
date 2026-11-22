import test from "node:test";
import assert from "node:assert/strict";
import { r1, bmiOf, range, statusOf } from "../public/bmi.js";

const p = { cm: 172 };

test("bmiOf rounds to one decimal", () => {
  assert.equal(bmiOf(p, 78.7), 26.6);
  assert.equal(r1(1.26), 1.3);
});

test("range gives the normal weights for a height", () => {
  assert.deepEqual(range(p), { lo: 54.7, hi: 73.7, asian: 67.7 });
});

test("statusOf follows the WHO cut-offs", () => {
  assert.equal(statusOf(18.4).t, "Underweight");
  assert.equal(statusOf(18.5).t, "Normal");
  assert.equal(statusOf(24.9).t, "Normal");
  assert.equal(statusOf(25).t, "Overweight");
  assert.equal(statusOf(30).t, "Obese");
});
