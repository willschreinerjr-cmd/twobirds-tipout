const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { root, script, loadCalculations } = require("./test-helpers.cjs");
const { calculateTipPool, calculateEventTips, parseGuestCount } = loadCalculations();
const staff = [
  { role: "Shift Manager", name: "Manager", hours: 5 },
  { role: "Bartender", name: "Bartender", hours: 3 },
  { role: "Bartender", name: "Second Bartender", hours: 2 }
];
const solo = [{ role: "Shift Manager", name: "Manager", hours: 1 }];

test("both production scripts compile without a build step", () => {
  new vm.Script(script);
  new vm.Script(fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8"));
});

test("cash preserves original role and hourly rates but rounds each payout up", () => {
  for (const pot of [0, 1, 23, 100, 301, 1000]) {
    for (const people of [staff, solo, staff.slice(0, 2), staff.map(p => ({ ...p, hours: p.hours + 0.25 }))]) {
      const payoutHours = people.reduce((n, p) => n + p.hours, 0);
      const rate = Math.round((pot / payoutHours) * 100) / 100;
      const actual = calculateEventTips(pot, 0, people, null);
      people.forEach((p, index) => {
        assert.equal(actual.cash.entries[index].rate, rate);
        assert.equal(actual.cash.entries[index].tipout, Math.ceil(Number((p.hours * rate).toFixed(10))));
      });
      assert.equal(actual.totalEarned, actual.cash.totalEarned);
      assert.equal(actual.guaranteedMinimum, null);
    }
  }
});

test("credit and paycheck shares preserve weights and allocate every cent", () => {
  const result = calculateEventTips(301, 301, staff, 200);
  assert.equal(result.credit.totalEarned, 301);
  assert.equal(result.totalEarned, result.cash.totalEarned + 301);
  assert.deepEqual(result.paycheck, calculateTipPool(result.paycheckDifference, staff, "cents"));
  const creditOnly = calculateEventTips(0, 301, staff, null);
  assert.equal(creditOnly.cash.totalEarned, 0);
  assert.deepEqual(creditOnly.credit, result.credit);
  for (const pot of [0.01, 0.02, 0.1, 100, 252.43, 301.99]) {
    for (const people of [staff, solo, staff.slice(0, 2), staff.map(p => ({ ...p, hours: p.hours + 0.13 }))]) {
      const pool = calculateTipPool(pot, people, "cents");
      assert.equal(pool.entries.reduce((sum, entry) => sum + Math.round(entry.tipout * 100), 0), Math.round(pot * 100));
      for (const entry of pool.entries) {
        assert.ok(Math.abs(entry.tipout - entry.hours * entry.rate) < 0.01000001);
      }
    }
  }
});

test("cash overages are explicit and guarantees use actual cents paid", () => {
  const people = [{ role: "Bartender", name: "One", hours: 1 }, { role: "Bartender", name: "Two", hours: 2 }];
  const result = calculateEventTips(100, 19.99, people, 30);
  assert.equal(result.cash.totalEarned, 101);
  assert.equal(result.cashRoundingDifference, 1);
  assert.equal(result.totalEarned, 120.99);
  assert.equal(result.paycheckDifference, 0);
  const short = calculateEventTips(0, 119.99, people, 30);
  assert.equal(short.paycheckDifference, 0.01);
  assert.equal(short.paycheck.totalEarned, 0.01);
  const exact = calculateEventTips(0, 120, people, 30);
  assert.equal(exact.paycheckDifference, 0);
  assert.equal(calculateTipPool(115.2, solo).entries[0].tipout, 116);
  assert.equal(calculateTipPool(115, solo).entries[0].tipout, 115);
  const unallocated = calculateEventTips(100, 25.43, [], 10);
  assert.equal(unallocated.creditUnallocated, 25.43);
  assert.equal(unallocated.cashRoundingDifference, -100);
  const excluded = calculateTipPool(10, [
    { role: "Trainee", name: "Trainee", hours: 2 },
    { role: "Server", name: "Server", hours: 2 }
  ], "cents");
  assert.equal(excluded.totalEarned, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(excluded.entries)), []);
});

test("guests only, shortages, exceeded minimum, zero guests, and absent guests", () => {
  const scenarios = [
    [0, 0, [], 10, 40, 0, 40],
    [20, 0, solo, 10, 40, 20, 20],
    [20, 10, solo, 10, 40, 30, 10],
    [300, 50, solo, 100, 400, 350, 50],
    [400, 50, solo, 100, 400, 450, 0],
    [400, 0, solo, 100, 400, 400, 0],
    [0, 0, solo, 0, 0, 0, 0],
    [0, 0, solo, null, null, 0, 0]
  ];
  scenarios.forEach(([cash, credit, people, guests, minimum, earned, owed]) => {
    const result = calculateEventTips(cash, credit, people, guests);
    assert.equal(result.guaranteedMinimum, minimum);
    assert.equal(result.totalEarned, earned);
    assert.equal(result.paycheckDifference, owed);
  });
  for (const guests of [10, 100, 150, 200]) {
    assert.equal(calculateEventTips(0, 0, [], guests).guaranteedMinimum, guests * 4);
  }
});

test("guest validation distinguishes empty, zero, and invalid input", () => {
  assert.equal(parseGuestCount("").count, null);
  assert.equal(parseGuestCount("  ").error, "");
  assert.equal(parseGuestCount("0").count, 0);
  assert.equal(parseGuestCount("150").count, 150);
  for (const invalid of ["-1", "1.5", "1e2", "abc", "+2", "1,000", "9007199254740991"]) {
    assert.ok(parseGuestCount(invalid).error, invalid);
    assert.equal(parseGuestCount(invalid).count, null);
  }
});

test("personal earnings use only Will's time cards and tax wages plus tips once", () => {
  const { calculatePersonalEarnings } = loadCalculations();
  const profile = { owner: "Will Schreiner", hourlyRate: 15, withholdingRate: 0.2074821353509878 };
  const people = [
    { role: "Shift Manager", name: "Will Schreiner", hours: 5 },
    { role: "Bartender", name: "Someone Else", hours: 5 }
  ];
  const result = calculateEventTips(100, 100, people, 100);
  const earnings = calculatePersonalEarnings(result, profile);
  assert.equal(earnings.hours, 5);
  assert.equal(earnings.wages, 75);
  assert.equal(earnings.tips, 100);
  assert.equal(earnings.paycheckShare, 100);
  assert.equal(earnings.withoutMinimum.gross, 175);
  assert.equal(earnings.withoutMinimum.tax, 36.31);
  assert.equal(earnings.withoutMinimum.net, 138.69);
  assert.equal(earnings.gross, 275);
  assert.equal(earnings.tax, 57.06);
  assert.equal(earnings.net, 217.94);
  assert.equal(earnings.withoutMinimum.hourlyGross, 35);
  assert.equal(earnings.withoutMinimum.hourlyNet, 27.74);
  assert.equal(earnings.hourlyGross, 55);
  assert.equal(earnings.hourlyNet, 43.59);
  assert.equal(calculatePersonalEarnings(calculateEventTips(0, 0, solo, null), profile), null);
  const wagesOnly = calculatePersonalEarnings(calculateEventTips(0, 0, people, null), profile);
  assert.equal(wagesOnly.gross, 75);
  assert.equal(wagesOnly.paycheckShare, 0);
  assert.equal(wagesOnly.hourlyGross, 15);
  assert.equal(wagesOnly.withoutMinimum.gross, wagesOnly.gross);
  const metMinimum = calculatePersonalEarnings(calculateEventTips(1000, 0, people, 10), profile);
  assert.equal(metMinimum.withoutMinimum.gross, metMinimum.gross);
  assert.equal(metMinimum.withoutMinimum.net, metMinimum.net);
  assert.equal(metMinimum.withoutMinimum.hourlyGross, metMinimum.hourlyGross);
  const partialHours = calculatePersonalEarnings(calculateEventTips(100, 0, [
    { role: "Bartender", name: "Will Schreiner", hours: 2.5 }
  ], null), profile);
  assert.equal(partialHours.hourlyGross, 55);
  assert.equal(partialHours.hourlyNet, 43.59);
});

test("Renee's wages use her role-specific hourly rates and shared tax estimate", () => {
  const { calculatePersonalEarnings } = loadCalculations();
  const profile = {
    owner: "Renee Ehlers",
    roleRates: { Bartender: 12, "Shift Manager": 14 },
    withholdingRate: 0.2074821353509878
  };
  const people = [
    { role: "Bartender", name: "Renee Ehlers", hours: 3 },
    { role: "Shift Manager", name: "Renee Ehlers", hours: 2 },
    { role: "Bartender", name: "Someone Else", hours: 1 }
  ];
  const result = calculateEventTips(0, 100, people, 100);
  const earnings = calculatePersonalEarnings(result, profile);
  assert.equal(earnings.hours, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(earnings.roleHours)), { Bartender: 3, "Shift Manager": 2 });
  assert.equal(earnings.wages, 64);
  assert.equal(earnings.tips, 83.33);
  assert.equal(earnings.paycheckShare, 250);
  assert.equal(earnings.withoutMinimum.gross, 147.33);
  assert.equal(earnings.withoutMinimum.tax, 30.57);
  assert.equal(earnings.withoutMinimum.net, 116.76);
  assert.equal(earnings.gross, 397.33);
  assert.equal(earnings.tax, 82.44);
  assert.equal(earnings.net, 314.89);
  assert.equal(earnings.hourlyGross, 79.47);
  assert.equal(earnings.hourlyNet, 62.98);
  const unsupported = calculatePersonalEarnings({
    cash: { entries: [{ role: "Server", name: "Renee Ehlers", hours: 1, tipout: 0 }] },
    credit: { entries: [{ tipout: 0 }] },
    paycheck: { entries: [{ tipout: 0 }] }
  }, profile);
  assert.match(unsupported.error, /No hourly rate is set for your Server shift/);
});

test("the backend recalculates saved shifts with the exact same tip and earnings code as the page", () => {
  const backend = fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8").replace(/\r\n/g, "\n");
  const page = script.replace(/\r\n/g, "\n");
  const pageCalculations = page.slice(page.indexOf("function calculateTipPool("), page.indexOf("const VENUES")).trim();
  const start = backend.indexOf("// BEGIN SHARED TIP CALCULATIONS");
  const backendCalculations = backend.slice(backend.indexOf("\n", start) + 1, backend.indexOf("// END SHARED TIP CALCULATIONS")).trim();
  assert.equal(backendCalculations, pageCalculations);
});
