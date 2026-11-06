const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadBackend } = require("./test-helpers.cjs");

const WILL_PIN = "1218";
const RENEE_PIN = "1212";
const JAKE_PIN = "2334";

function signIn(backend, pin) {
  return backend.post({ action: "authManagerPin", pin });
}

let keyCounter = 0;
function newKey() {
  return `test-key-${String(++keyCounter).padStart(12, "0")}`;
}

function event(overrides = {}) {
  return {
    shiftDate: "2026-11-05", venue: "Ivy House", cashPot: 200, creditPot: 100, isWedding: false, guestCount: null,
    staff: [
      { role: "Shift Manager", name: "Will Schreiner", hours: 5 },
      { role: "Bartender", name: "Staff 2", hours: 5 }
    ],
    ...overrides
  };
}

function saveShift(backend, session, overrides = {}, idempotencyKey = newKey()) {
  return backend.post({
    action: "saveEarningsShift", managerName: session.managerName, authToken: session.authToken,
    idempotencyKey, event: event(overrides)
  });
}

function storedShifts(backend) {
  const sheet = backend.earningsData().getSheetByName("Shifts");
  if (!sheet) return [];
  const [header, ...rows] = sheet.rows;
  return rows.map(row => Object.fromEntries(header.map((column, index) => [column, row[index]])));
}

test("backend offers each personal profile only to its matching authenticated account", () => {
  const backend = loadBackend();
  assert.equal(backend.context.getPersonalEarningsProfile("Someone Else"), null);
  assert.equal(backend.context.getPersonalEarningsProfile(""), null);
  const profile = backend.context.getPersonalEarningsProfile("Will Schreiner");
  assert.equal(profile.owner, "Will Schreiner");
  assert.equal(profile.hourlyRate, 15);
  assert.ok(profile.withholdingRate > 0 && profile.withholdingRate < 1);
  const renee = backend.context.getPersonalEarningsProfile("Renee Ehlers");
  assert.deepEqual(JSON.parse(JSON.stringify(renee.roleRates)), { Bartender: 12, "Shift Manager": 14 });
  assert.equal(renee.withholdingRate, profile.withholdingRate);
  assert.equal(backend.context.getPersonalEarningsProfile("Renee"), null);
  assert.equal(backend.context.getPersonalEarningsProfile("renee ehlers").owner, "Renee Ehlers");
});

test("manager PIN authentication and session validation still work for every manager", () => {
  const backend = loadBackend();
  const jake = signIn(backend, JAKE_PIN);
  assert.equal(jake.ok, true);
  assert.equal(jake.managerName, "Jake Faapito");
  assert.equal(jake.personalEarningsProfile, null);
  assert.equal("earningsTracker" in jake, false);
  const valid = backend.post({ action: "validateManagerSession", managerName: "Jake Faapito", authToken: jake.authToken });
  assert.deepEqual([valid.ok, valid.valid, "earningsTracker" in valid], [true, true, false]);
  const wrongName = backend.post({ action: "validateManagerSession", managerName: "Will Schreiner", authToken: jake.authToken });
  assert.equal(wrongName.valid, false);
  assert.equal(wrongName.personalEarningsProfile, null);
  assert.equal("earningsTracker" in wrongName, false);
  const bad = signIn(backend, "9999");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Invalid manager PIN/);
});

test("only Will's authenticated session can save shifts to Will's Earnings", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  assert.equal(will.earningsTracker, true);
  assert.equal(will.earningsSiteUrl, "https://script.google.com/macros/s/test-earnings-site/exec");
  const willSession = backend.post({ action: "validateManagerSession", managerName: "Will Schreiner", authToken: will.authToken });
  assert.equal(willSession.earningsTracker, true);

  for (const pin of [RENEE_PIN, JAKE_PIN]) {
    const other = signIn(backend, pin);
    assert.equal("earningsTracker" in other, false);
    assert.equal("earningsSiteUrl" in other, false);
    const own = saveShift(backend, other);
    assert.equal(own.ok, false);
    assert.match(own.error, /Unsupported action/);
    const spoofed = saveShift(backend, { managerName: "Will Schreiner", authToken: other.authToken });
    assert.equal(spoofed.ok, false);
    assert.match(spoofed.error, /Invalid auth session/);
  }
  assert.equal(saveShift(backend, { managerName: "Will Schreiner", authToken: "forged" }).ok, false);
  assert.equal(saveShift(backend, { managerName: "Will Schreiner" }).ok, false);
  for (const action of ["trackerList", "trackerSaveShift", "trackerDeleteShift", "trackerSetPaycheck"]) {
    assert.match(backend.post({ action, managerName: "Will Schreiner", authToken: will.authToken }).error, /Unsupported action/);
  }
  assert.deepEqual(storedShifts(backend), [], "rejected requests write nothing");
  const legacyReceipt = backend.post({ managerName: "Will Schreiner", authToken: will.authToken, venue: "Ivy House", entries: [] });
  assert.equal(legacyReceipt.ok, false, "the Google Sheets receipt writer stays removed");
});

test("saved shifts are recalculated on the server and stored in whole cents", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  const response = saveShift(backend, will, { gross: 999999, net: 999999, wages: 999999 });
  assert.equal(response.ok, true, response.error);
  assert.equal(response.saved, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.shift)).grossCents, 22500);
  const [shift] = storedShifts(backend);
  assert.deepEqual(
    [shift.shiftDate, shift.venue, shift.eventType, shift.role, shift.hours, shift.hourlyWageCents, shift.wageCents,
      shift.cashTipsCents, shift.creditTipsCents, shift.guaranteeCents, shift.grossCents, shift.taxCents,
      shift.netCents, shift.cashReceivedCents, shift.depositCents, shift.payPeriodStart, shift.payPeriodEnd, shift.source],
    ["2026-11-05", "Ivy House", "non-wedding", "Shift Manager", "5", "1500", "7500",
      "10000", "5000", "0", "22500", "4668", "17832", "10000", "7832", "2026-10-26", "2026-11-08", "TwoBirds Tipout"]
  );
  for (const field of ["wageCents", "cashTipsCents", "creditTipsCents", "grossCents", "taxCents", "netCents", "depositCents"]) {
    assert.match(shift[field], /^-?\d+$/, `${field} is stored as integer cents`);
  }
  assert.ok(shift.id && shift.createdAt && shift.updatedAt);
  assert.equal(JSON.stringify(storedShifts(backend)).includes("Staff 2"), false, "coworker names are not stored");
});

test("retries with the same key never duplicate a shift, but separate shifts on one day are allowed", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  const key = newKey();
  const first = saveShift(backend, will, {}, key);
  const retry = saveShift(backend, will, {}, key);
  assert.equal(first.saved, true);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.shift.id, first.shift.id);
  assert.equal(storedShifts(backend).length, 1);
  const secondEvent = saveShift(backend, will, { venue: "Starling" });
  assert.equal(secondEvent.saved, true);
  assert.equal(storedShifts(backend).length, 2);
});

test("only weddings include the $4-per-guest guarantee in saved earnings", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  const wedding = saveShift(backend, will, { isWedding: true, guestCount: 100 });
  const nonWedding = saveShift(backend, will, { isWedding: false, guestCount: 100 });
  const missingFlag = saveShift(backend, will, { isWedding: "yes", guestCount: 100 });
  const [w, n, m] = storedShifts(backend);
  assert.deepEqual([w.eventType, w.guaranteeCents, w.grossCents, w.taxCents, w.netCents, w.depositCents],
    ["wedding", "5000", "27500", "5706", "21794", "11794"]);
  assert.deepEqual([n.eventType, n.guaranteeCents, n.grossCents], ["non-wedding", "0", "22500"]);
  assert.deepEqual([m.eventType, m.guaranteeCents], ["non-wedding", "0"]);
  assert.ok(wedding.saved && nonWedding.saved && missingFlag.saved);
});

test("invalid shifts are rejected without storing anything", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  const cases = [
    [{ venue: "Somewhere Else" }, /venue/],
    [{ shiftDate: "2026-02-30" }, /date/],
    [{ cashPot: -1 }, /Cash tip pot/],
    [{ creditPot: 1.234 }, /Credit tips/],
    [{ isWedding: true, guestCount: 1.5 }, /guest count/],
    [{ staff: [{ role: "Bartender", name: "Staff 1", hours: 5 }] }, /Add Will Schreiner/],
    [{ staff: [{ role: "Server", name: "Will Schreiner", hours: 5 }] }, /invalid role/],
    [{ staff: [] }, /time cards/]
  ];
  for (const [overrides, error] of cases) {
    const response = saveShift(backend, will, overrides);
    assert.equal(response.ok, false, JSON.stringify(overrides));
    assert.match(response.error, error);
  }
  const badKey = backend.post({ action: "saveEarningsShift", managerName: will.managerName, authToken: will.authToken,
    idempotencyKey: "x", event: event() });
  assert.match(badKey.error, /Invalid save request/);
  assert.deepEqual(storedShifts(backend), []);
});

test("shifts follow the configured pay schedule and cannot be added to a verified pay period", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  saveShift(backend, will);
  const data = backend.earningsData();
  data.getSheetByName("PaySchedule").rows.push(["2026-11-09", "7", "2026-11-01T00:00:00.000Z"]);
  saveShift(backend, will, { shiftDate: "2026-11-10" });
  saveShift(backend, will, { shiftDate: "2026-11-08" });
  assert.deepEqual(storedShifts(backend).map(shift => [shift.shiftDate, shift.payPeriodStart, shift.payPeriodEnd]), [
    ["2026-11-05", "2026-10-26", "2026-11-08"],
    ["2026-11-10", "2026-11-09", "2026-11-15"],
    ["2026-11-08", "2026-10-26", "2026-11-08"]
  ]);
  const paychecks = data.getSheetByName("Paychecks");
  paychecks.rows.push(["2026-10-26", "2026-11-08", "verified", "", "", "", "", "", ""]);
  const locked = saveShift(backend, will, { shiftDate: "2026-11-01" });
  assert.equal(locked.ok, false);
  assert.match(locked.error, /Verified/);
  assert.equal(storedShifts(backend).length, 3);
});

test("the calculator keeps working when Will's Earnings is not connected or unavailable", () => {
  const backend = loadBackend({ connectEarnings: false });
  const will = signIn(backend, WILL_PIN);
  assert.equal(will.ok, true);
  assert.equal(will.earningsTracker, true);
  assert.equal("earningsSiteUrl" in will, false);
  assert.match(saveShift(backend, will).error, /not connected/);
  backend.properties.set("WILLS_EARNINGS_SPREADSHEET_ID", "missing-sheet");
  assert.equal(saveShift(backend, will).ok, false);
  assert.equal(signIn(backend, JAKE_PIN).ok, true);
});

test("expired manager sessions are pruned when someone signs in", () => {
  const backend = loadBackend();
  backend.properties.set("managerAuthSession:old", JSON.stringify({ managerName: "Jake Faapito", expiresAt: Date.now() - 1 }));
  backend.properties.set("managerAuthSession:broken", "{");
  const active = signIn(backend, JAKE_PIN);
  assert.equal(backend.properties.has("managerAuthSession:old"), false);
  assert.equal(backend.properties.has("managerAuthSession:broken"), false);
  signIn(backend, RENEE_PIN);
  assert.equal(backend.post({ action: "validateManagerSession", managerName: "Jake Faapito", authToken: active.authToken }).valid, true);
});
