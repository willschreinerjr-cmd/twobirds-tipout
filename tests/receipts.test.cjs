const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadReceiptHelpers } = require("./test-helpers.cjs");
const { root } = require("./test-helpers.cjs");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildReceiptDetailRows } = loadReceiptHelpers();
const entry = { role: "Shift Manager", name: "Will Schreiner", hours: 1, tipout: 20, creditTipout: 10 };

test("cash-only receipt retains the original four-column detail format", () => {
  const rows = buildReceiptDetailRows({}, [entry]);
  assert.equal(JSON.stringify(rows), JSON.stringify([["Shift Manager", "Will Schreiner", 1, "$20"]]));
});

test("receipt persists separate credit and guarantee amounts and time-card shares", () => {
  const rows = buildReceiptDetailRows({
    creditPot: 10, totalTipsEarned: 30, guestCount: 10, guaranteedMinimum: 40,
    paycheckDifference: 10, paycheckEntries: [{ ...entry, tipout: 10 }], paycheckRemainder: 0
  }, [entry]);
  assert.ok(rows.some(row => row[0] === "Credit Tip Pot:" && row[1] === "$10.00"));
  assert.ok(rows.some(row => row[0] === "Guaranteed Tip Minimum:" && row[1] === "$40.00"));
  assert.ok(rows.some(row => row[0] === "Additional Paycheck Amount:" && row[1] === "$10.00"));
  assert.ok(rows.some(row => row[3] === "$10.00" && row[1] === "Will Schreiner"));
  assert.ok(rows.every(row => row.length === 4));
  assert.ok(rows.every(row => row.some(value => value !== "")));
});

test("zero guests and a met guarantee persist without paycheck shares", () => {
  const rows = buildReceiptDetailRows({
    guestCount: 0, guaranteedMinimum: 0, totalTipsEarned: 20, paycheckDifference: 0
  }, [entry]);
  assert.ok(rows.some(row => row[0] === "Number of Guests:" && row[1] === 0));
  assert.ok(rows.some(row => row[0] === "Additional Paycheck Amount:" && row[1] === "$0.00"));
  assert.ok(!rows.some(row => row[0] === "Paycheck Shares"));
});

test("receipt preserves cash overage, exact credit cents, combined tips and paycheck cents", () => {
  const rows = buildReceiptDetailRows({
    cashRoundingDifference: 1, creditPot: 252.43, totalTipsEarned: 353.43,
    guestCount: 100, guaranteedMinimum: 400, paycheckDifference: 46.57,
    paycheckEntries: [{ ...entry, tipout: 15.52 }]
  }, [{ ...entry, tipout: 34, creditTipout: 84.14 }]);
  assert.equal(rows[0][3], "$34");
  assert.ok(rows.some(row => row[0] === "Extra cash needed for rounding:" && row[1] === "$1"));
  assert.ok(rows.some(row => row[0] === "Credit Tip Pot:" && row[1] === "$252.43"));
  assert.ok(rows.some(row => row[3] === "$84.14"));
  assert.ok(rows.some(row => row[3] === "$118.14"));
  assert.ok(rows.some(row => row[0] === "Additional Paycheck Amount:" && row[1] === "$46.57"));
  assert.ok(rows.some(row => row[3] === "$15.52"));
});

test("backend offers each personal profile only to its matching authenticated account", () => {
  const source = fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8");
  const helper = source.slice(source.indexOf("function getPersonalEarningsProfile("), source.indexOf("function moneyWhole("));
  const context = vm.createContext({});
  vm.runInContext(helper, context);
  assert.equal(context.getPersonalEarningsProfile("Someone Else"), null);
  assert.equal(context.getPersonalEarningsProfile(""), null);
  const profile = context.getPersonalEarningsProfile("Will Schreiner");
  assert.equal(profile.owner, "Will Schreiner");
  assert.equal(profile.hourlyRate, 15);
  assert.ok(profile.withholdingRate > 0 && profile.withholdingRate < 1);
  const renee = context.getPersonalEarningsProfile("Renee Ehlers");
  assert.deepEqual(JSON.parse(JSON.stringify(renee.roleRates)), { Bartender: 12, "Shift Manager": 14 });
  assert.equal(renee.withholdingRate, profile.withholdingRate);
  assert.equal(context.getPersonalEarningsProfile("Someone Else"), null);
  assert.equal(context.getPersonalEarningsProfile("Renee"), null);
  assert.equal(context.getPersonalEarningsProfile("renee ehlers").owner, "Renee Ehlers");
});
