// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { countryOf, flagOf, isBot, summarise, UNKNOWN } from "../public/visits.js";

test("countryOf maps time zones to countries", () => {
  assert.equal(countryOf("Asia/Kuala_Lumpur"), "MY");
  assert.equal(countryOf("Asia/Kuching"), "MY");
  assert.equal(countryOf("Asia/Singapore"), "SG");
  assert.equal(countryOf("America/Indiana/Indianapolis"), "US");
  assert.equal(countryOf("Europe/London"), "GB");
  assert.equal(countryOf("Asia/Calcutta"), "IN");
  assert.equal(countryOf("UTC"), UNKNOWN);
  assert.equal(countryOf(""), UNKNOWN);
});

test("every time zone this runtime knows has a country, except Etc and UTC", () => {
  const missing = Intl.supportedValuesOf("timeZone").filter((z) => !/^(Etc\/|UTC$)/.test(z) && countryOf(z) === UNKNOWN);
  assert.deepEqual(missing, []);
});

test("flagOf builds flag emoji", () => {
  assert.equal(flagOf("MY"), "🇲🇾");
  assert.equal(flagOf(UNKNOWN), "🌐");
});

test("isBot spots crawlers and automation", () => {
  assert.ok(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)", false));
  assert.ok(isBot("Mozilla/5.0 HeadlessChrome/120", false));
  assert.ok(isBot("Mozilla/5.0 (iPhone)", true));
  assert.ok(!isBot("Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile", false));
});

test("summarise totals, sorts biggest first, unknown last, drops bad rows", () => {
  const s = summarise([{ id: "ZZ", n: 9 }, { id: "SG", n: 2 }, { id: "MY", n: 5 }, { id: "AU", n: 2 }, { id: "bad", n: 3 }, { id: "US", n: -1 }]);
  assert.equal(s.total, 18);
  assert.deepEqual(s.countries.map((c) => c.cc), ["MY", "AU", "SG", "ZZ"]);
});
