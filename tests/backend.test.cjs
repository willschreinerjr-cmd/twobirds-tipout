const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadBackend } = require("./test-helpers.cjs");

const WILL_PIN = "1218";
const RENEE_PIN = "1212";
const JAKE_PIN = "2334";

function signIn(backend, pin) {
  return backend.post({ action: "authManagerPin", pin });
}

function trackerCall(backend, session, action, extra = {}) {
  return backend.post({ action, managerName: session.managerName, authToken: session.authToken, ...extra });
}

const shiftInput = {
  shiftDate: "2026-11-05", venue: "Ivy House", hours: 5,
  cashTips: 100, creditTips: 50, tipMinimum: 0
};

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

test("only Will's authenticated session is offered or allowed to use the earnings tracker", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  assert.equal(will.earningsTracker, true);
  const willSession = backend.post({ action: "validateManagerSession", managerName: "Will Schreiner", authToken: will.authToken });
  assert.equal(willSession.earningsTracker, true);

  for (const pin of [RENEE_PIN, JAKE_PIN]) {
    const other = signIn(backend, pin);
    assert.equal("earningsTracker" in other, false);
    for (const action of ["trackerList", "trackerSaveShift", "trackerDeleteShift", "trackerSetPaycheck"]) {
      const response = trackerCall(backend, other, action, { shift: shiftInput, id: "x", periodStart: "2026-10-26" });
      assert.equal(response.ok, false, `${pin} ${action}`);
      assert.match(response.error, /Unsupported action/);
      assert.equal(response.shifts, undefined);
    }
    const spoofed = backend.post({ action: "trackerList", managerName: "Will Schreiner", authToken: other.authToken });
    assert.equal(spoofed.ok, false);
  }
  assert.equal(backend.post({ action: "trackerList", managerName: "Will Schreiner" }).ok, false);
  assert.equal(backend.post({ action: "trackerList", managerName: "Will Schreiner", authToken: "forged" }).ok, false);
  assert.equal(backend.spreadsheets.length, 0, "unauthorized calls must not touch storage");
  const legacyReceipt = backend.post({ managerName: "Will Schreiner", authToken: will.authToken, venue: "Ivy House", entries: [] });
  assert.equal(legacyReceipt.ok, false, "the Google Sheets receipt writer is removed");
});

test("Will can save, replace, correct, and delete shifts with server-calculated totals", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  const empty = trackerCall(backend, will, "trackerList");
  assert.deepEqual([empty.ok, empty.shifts.length, empty.payPeriodAnchor, empty.payPeriodDays], [true, 0, "2026-10-12", 14]);
  assert.equal(backend.spreadsheets.length, 1);
  assert.equal(backend.spreadsheets[0].name, "TwoBirds Tipout - Private Earnings Tracker");

  const saved = trackerCall(backend, will, "trackerSaveShift", { shift: { ...shiftInput, gross: 1, net: 1 } });
  assert.equal(saved.ok, true);
  assert.equal(saved.replaced, false);
  assert.deepEqual(
    [saved.saved.wages, saved.saved.gross, saved.saved.tax, saved.saved.net],
    [75, 225, 46.68, 178.32],
    "totals come from the same rate and withholding as the calculator"
  );
  assert.equal(saved.shifts.length, 1);

  const duplicate = trackerCall(backend, will, "trackerSaveShift", { shift: { ...shiftInput, cashTips: 200 } });
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.duplicate.id, saved.saved.id);
  assert.equal(duplicate.saved, undefined);
  assert.equal(duplicate.shifts.length, 1);
  assert.equal(duplicate.shifts[0].cashTips, 100);

  const replaced = trackerCall(backend, will, "trackerSaveShift", {
    replace: true, shift: { ...shiftInput, venue: "ivy house", cashTips: 200, tipMinimum: 25.5 }
  });
  assert.equal(replaced.replaced, true);
  assert.equal(replaced.shifts.length, 1);
  assert.equal(replaced.shifts[0].id, saved.saved.id);
  assert.equal(replaced.shifts[0].gross, 350.5);

  const second = trackerCall(backend, will, "trackerSaveShift", { shift: { ...shiftInput, shiftDate: "2026-10-27", hours: 2.5 } });
  assert.deepEqual(second.shifts.map(shift => shift.shiftDate), ["2026-10-27", "2026-11-05"]);
  const conflict = trackerCall(backend, will, "trackerUpdateShift", {
    id: second.saved.id, shift: { ...shiftInput, shiftDate: "2026-11-05" }
  });
  assert.ok(conflict.duplicate);
  assert.equal(conflict.shifts.find(shift => shift.id === second.saved.id).shiftDate, "2026-10-27");

  const corrected = trackerCall(backend, will, "trackerUpdateShift", {
    id: second.saved.id, shift: { ...shiftInput, shiftDate: "2026-10-28", hours: 3, cashTips: 10, creditTips: 0.43 }
  });
  const fixed = corrected.shifts.find(shift => shift.id === second.saved.id);
  assert.deepEqual([fixed.shiftDate, fixed.hours, fixed.wages, fixed.gross], ["2026-10-28", 3, 45, 55.43]);
  assert.equal(fixed.savedAt, second.saved.savedAt);

  for (const bad of [{ hours: 0 }, { hours: 25 }, { cashTips: -1 }, { shiftDate: "2026-02-30" }, { venue: "" }, { creditTips: "abc" }]) {
    const response = trackerCall(backend, will, "trackerSaveShift", { shift: { ...shiftInput, ...bad } });
    assert.equal(response.ok, false, JSON.stringify(bad));
  }

  const deleted = trackerCall(backend, will, "trackerDeleteShift", { id: second.saved.id });
  assert.equal(deleted.deleted, true);
  assert.deepEqual(deleted.shifts.map(shift => shift.id), [saved.saved.id]);
  assert.equal(trackerCall(backend, will, "trackerUpdateShift", { id: second.saved.id, shift: shiftInput }).ok, false);

  const reloaded = loadBackend({ properties: backend.properties, spreadsheets: backend.spreadsheets });
  const stillSaved = reloaded.post({ action: "trackerList", managerName: "Will Schreiner", authToken: will.authToken });
  assert.equal(stillSaved.shifts.length, 1, "history persists across executions");
});

test("actual paychecks are stored per valid two-week pay period", () => {
  const backend = loadBackend();
  const will = signIn(backend, WILL_PIN);
  assert.equal(trackerCall(backend, will, "trackerSetPaycheck", { periodStart: "2026-10-27", actualPaycheck: 10 }).ok, false);
  assert.equal(trackerCall(backend, will, "trackerSetPaycheck", { periodStart: "2026-10-26", actualPaycheck: -1 }).ok, false);
  let response = trackerCall(backend, will, "trackerSetPaycheck", { periodStart: "2026-10-26", actualPaycheck: 512.345 });
  assert.equal(response.paychecks["2026-10-26"], 512.35);
  response = trackerCall(backend, will, "trackerSetPaycheck", { periodStart: "2026-09-28", actualPaycheck: 400 });
  assert.deepEqual(JSON.parse(JSON.stringify(response.paychecks)), { "2026-10-26": 512.35, "2026-09-28": 400 });
  response = trackerCall(backend, will, "trackerSetPaycheck", { periodStart: "2026-10-26", actualPaycheck: null });
  assert.deepEqual(JSON.parse(JSON.stringify(response.paychecks)), { "2026-09-28": 400 });
});
