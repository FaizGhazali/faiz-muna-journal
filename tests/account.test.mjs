// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailOf, personOf, tryOrder, isWrongPassword, checkNewPassword } from "../public/logic/account.js";

test("each person's login name maps back to them", () => {
  assert.equal(emailOf("p2"), "p2@journal.invalid");
  assert.equal(personOf("p1@journal.invalid"), "p1");
  assert.equal(personOf("P2@Journal.invalid"), "p2");
  assert.equal(personOf("family@journal.invalid"), null);
  assert.equal(personOf("p3@journal.invalid"), null);
  assert.equal(personOf(null), null);
});

test("the person last signed in here is tried first", () => {
  assert.deepEqual(tryOrder("p2"), ["p2", "p1"]);
  assert.deepEqual(tryOrder("p1"), ["p1", "p2"]);
  assert.deepEqual(tryOrder(undefined), ["p1", "p2"]);
});

test("only wrong-password answers move on to the next person", () => {
  assert.ok(isWrongPassword("auth/invalid-credential"));
  assert.ok(!isWrongPassword("auth/too-many-requests"));
  assert.ok(!isWrongPassword("auth/network-request-failed"));
});

test("a new password is long enough, new, and typed the same twice", () => {
  assert.match(checkNewPassword("", "", "old"), /Type/);
  assert.match(checkNewPassword("short", "short", "old"), /8/);
  assert.match(checkNewPassword("temp1234", "temp1234", "temp1234"), /different/);
  assert.match(checkNewPassword("goodpass1", "goodpass2", "old"), /match/);
  assert.equal(checkNewPassword("goodpass1", "goodpass1", "old"), "");
  assert.equal(checkNewPassword("goodpass1", "goodpass1", ""), ""); // old one unknown after a reopen
});
