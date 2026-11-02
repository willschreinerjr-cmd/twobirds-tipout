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
  { role: "Training", name: "Trainee", hours: 2 }
];
const solo = [{ role: "Shift Manager", name: "Manager", hours: 1 }];

test("both production scripts compile without a build step", () => {
  new vm.Script(script);
  new vm.Script(fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8"));
});

test("cash-only matches the original algorithm including rounding for varied time cards", () => {
  for (const pot of [0, 1, 23, 100, 301, 1000]) {
    for (const people of [staff, solo, staff.slice(0, 2), staff.map(p => ({ ...p, hours: p.hours + 0.25 }))]) {
      const training = people.filter(p => p.role === "Training");
      const bartenders = people.filter(p => p.role !== "Training");
      const trainingPool = training.length ? pot * 0.1 : 0;
      const trainingHours = training.reduce((n, p) => n + p.hours, 0);
      const bartenderHours = bartenders.reduce((n, p) => n + p.hours, 0);
      const trainingRate = trainingHours ? Math.round(trainingPool / trainingHours * 100) / 100 : 0;
      const baseRate = Math.round((pot - trainingPool) / bartenderHours * 100) / 100;
      const actual = calculateEventTips(pot, 0, people, null);
      people.forEach((p, index) => {
        const rate = p.role === "Training" ? trainingRate : baseRate;
        assert.equal(actual.cash.entries[index].rate, rate);
        assert.equal(actual.cash.entries[index].tipout, Math.floor(p.hours * rate));
      });
      assert.equal(actual.totalEarned, actual.cash.totalEarned);
      assert.equal(actual.guaranteedMinimum, null);
    }
  }
});

test("cash and credit are allocated independently with identical rules, never twice", () => {
  const result = calculateEventTips(301, 301, staff, 200);
  assert.deepEqual(result.cash, result.credit);
  assert.equal(result.totalEarned, 2 * result.cash.totalEarned);
  assert.equal(result.cash.trainingPool, 30.1);
  assert.deepEqual(result.paycheck, calculateTipPool(result.paycheckDifference, staff));
  const creditOnly = calculateEventTips(0, 301, staff, null);
  assert.equal(creditOnly.cash.totalEarned, 0);
  assert.deepEqual(creditOnly.credit, result.cash);
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
