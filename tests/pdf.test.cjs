const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const { script, loadCalculations } = require("./test-helpers.cjs");
const calculations = loadCalculations();
const context = vm.createContext({ TextEncoder });
vm.runInContext(
  script.slice(script.indexOf("function moneyWhole("), script.indexOf("function calculateTipPool(")) +
  script.slice(script.indexOf("function buildEarningsPdf("), script.indexOf("async function downloadPersonalEarnings(")),
  context
);
const profile = { owner: "Will Schreiner", hourlyRate: 15, withholdingRate: 0.2074821353509878 };
const people = [
  { role: "Shift Manager", name: "Will Schreiner", hours: 1 },
  { role: "Bartender", name: "Someone Else", hours: 2 }
];

test("PDF receipt uses only Will's rounded cash, exact credit and actual guarantee share", async () => {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  for (const [cash, credit, guests] of [[100, 50.43, 100], [100, 50.43, 0], [100, 0, null], [0, 252.43, null]]) {
    const result = calculations.calculateEventTips(cash, credit, people, guests);
    const earnings = calculations.calculatePersonalEarnings(result, profile);
    const bytes = context.buildEarningsPdf(earnings, result, profile.owner, "2026-11-01", "Ivy House");
    const pdf = await getDocument({ data: bytes, useSystemFonts: true }).promise;
    try {
      assert.equal(pdf.numPages, 1);
      const page = await pdf.getPage(1);
      const content = await page.getTextContent();
      const labels = content.items.filter(item => item.str.trim()).map(item => item.str);
      const valueAfter = label => labels[labels.indexOf(label) + 1];
      assert.equal(valueAfter("Cash tips"), `$${result.cash.entries[0].tipout}`);
      assert.equal(valueAfter("Credit tips"), `$${result.credit.entries[0].tipout.toFixed(2)}`);
      assert.equal(valueAfter("Hourly wages"), "$15.00");
      assert.equal(valueAfter("TOTAL EARNED BEFORE TAX"), `$${earnings.gross.toFixed(2)}`);
      assert.equal(valueAfter("EST. AFTER TAX"), `$${earnings.net.toFixed(2)}`);
      assert.equal(valueAfter("PER HOUR / BEFORE TAX"), `$${earnings.hourlyGross.toFixed(2)}/hr`);
      assert.equal(labels.includes("Paycheck guarantee added"), earnings.paycheckShare > 0);
      if (earnings.paycheckShare > 0) {
        assert.equal(valueAfter("Paycheck guarantee added"), `$${earnings.paycheckShare.toFixed(2)}`);
        assert.equal(earnings.gross, 148.67);
      }
      assert.equal(labels.filter(label => label === profile.owner).length, 1);
      assert.ok(!labels.some(label => /Tip Minimum|Guests|Withholding/.test(label)));
    } finally {
      await pdf.destroy();
    }
  }
});
