const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { root } = require("./test-helpers.cjs");

let server;
let browser;
let baseURL;
before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    const filename = path.basename(url.pathname) || "index.html";
    const file = path.join(root, filename);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    const contentTypes = { ".html": "text/html", ".js": "text/javascript", ".webmanifest": "application/manifest+json" };
    response.setHeader("Content-Type", contentTypes[path.extname(file)] || "application/octet-stream");
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(baseURL)).status, 200);
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  ].find(filename => filename && fs.existsSync(filename));
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
});
after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function openCalculator(t, width = 1100) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (route.request().url().startsWith(baseURL)) return route.continue();
    return route.abort();
  });
  t.after(async () => {
    if (t.passed === false) {
      fs.mkdirSync(path.join(root, "test-results"), { recursive: true });
      await page.screenshot({ path: path.join(root, "test-results", `${t.name.replace(/\W+/g, "-")}.png`), fullPage: true });
    }
    await context.close();
    assert.deepEqual(errors, []);
  });
  await page.goto(baseURL);
  assert.equal(await page.locator("#pinGate").isVisible(), true);
  // Isolate calculator behavior from the live manager/Toast services.
  await page.evaluate(() => {
    document.getElementById("pinGate").style.display = "none";
    document.body.classList.remove("pin-gate-active");
    document.body.style.overflow = "";
  });
  return page;
}

async function soloTimeCard(page) {
  await page.evaluate(() => {
    document.getElementById("staffBody").innerHTML = "";
    addStaff("Shift Manager", "Test Manager", "1", false);
  });
}

async function fill(page, id, value) {
  await page.locator(`#${id}`).fill(value);
}

async function text(page, id, expected) {
  assert.equal(await page.locator(`#${id}`).textContent(), expected, id);
}

test("Jon Slock is available as a bartender name suggestion", async t => {
  const page = await openCalculator(t);
  const nameInput = page.locator("#staffBody input").first();
  await nameInput.fill("Jon");
  await page.getByRole("button", { name: "Jon Slock", exact: true }).click();
  assert.equal(await nameInput.inputValue(), "Jon Slock");
  assert.equal(await page.locator("#staffBody .staff-role").first().inputValue(), "Bartender");
});

test("live cash, credit, guests, exceeded minimum, and optional-field clearing", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "pot", "150");
  await text(page, "cashTotal", "$150");
  assert.equal(await page.locator("#combinedResult").isVisible(), false);
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
  assert.equal(await page.locator("#resultsBody b").textContent(), "$150");
  await fill(page, "creditPot", "75");
  await text(page, "combinedTotal", "$225.00");
  await text(page, "cashTotal", "$150");
  await fill(page, "guestCount", "100");
  await text(page, "guaranteedMinimum", "$400.00");
  await text(page, "totalTipsEarned", "$225.00");
  await text(page, "paycheckAmount", "$175.00");
  assert.equal(await page.locator("#paycheckBody td").last().textContent(), "$175.00");
  await fill(page, "pot", "400");
  await text(page, "paycheckAmount", "$0.00");
  assert.equal(await page.locator("#guaranteeMet").isVisible(), true);
  await fill(page, "pot", "");
  await text(page, "cashTotal", "$0");
  await text(page, "totalTipsEarned", "$75.00");
  await text(page, "paycheckAmount", "$325.00");
  await fill(page, "creditPot", "");
  await text(page, "paycheckAmount", "$400.00");
  assert.equal(await page.locator("#combinedResult").isVisible(), false);
  await fill(page, "guestCount", "");
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
});

test("guest-only preview rejects invalid counts, handles zero, and resets cleanly", async t => {
  const page = await openCalculator(t);
  await fill(page, "guestCount", "10");
  await text(page, "guaranteedMinimum", "$40.00");
  await text(page, "totalTipsEarned", "$0.00");
  await text(page, "paycheckAmount", "$40.00");
  for (const invalid of ["-1", "1.5", "1e2", "abc"]) {
    await fill(page, "guestCount", invalid);
    assert.equal(await page.locator("#guestError").isVisible(), true);
    assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
    assert.equal(await page.locator("#guestCount").evaluate(el => el.checkValidity()), false);
  }
  await fill(page, "guestCount", "0");
  await text(page, "guaranteedMinimum", "$0.00");
  await text(page, "paycheckAmount", "$0.00");
  assert.equal(await page.locator("#guestError").isVisible(), false);
  await page.locator("#reset").click();
  assert.equal(await page.locator("#guestCount").inputValue(), "");
  assert.equal(await page.locator("#creditPot").inputValue(), "");
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
});

test("time-card hours, roles, additions and removals update every dependent payout", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "pot", "100");
  await fill(page, "creditPot", "100");
  await fill(page, "guestCount", "100");
  await page.evaluate(() => addStaff("Training", "Test Trainee", "2", false));
  assert.equal(await page.locator("#resultsBody tr").count(), 2);
  assert.equal(await page.locator("#resultsBody b").nth(0).textContent(), "$90");
  assert.equal(await page.locator("#resultsBody b").nth(1).textContent(), "$10");
  await text(page, "paycheckAmount", "$200.00");
  await page.locator(".staff-role").nth(1).selectOption("Bartender");
  assert.equal(await page.locator("#resultsBody b").nth(0).textContent(), "$34");
  assert.equal(await page.locator("#resultsBody b").nth(1).textContent(), "$67");
  await text(page, "totalTipsEarned", "$201.00");
  await text(page, "paycheckAmount", "$199.00");
  await text(page, "cashRounding", "Cash rounding: $1 extra cash needed above the original pot.");
  await page.locator(".hours-input").nth(1).fill("1");
  assert.equal(await page.locator("#resultsBody b").nth(0).textContent(), "$50");
  await text(page, "totalTipsEarned", "$200.00");
  await page.locator(".remove").nth(1).click();
  assert.equal(await page.locator("#resultsBody tr").count(), 1);
  assert.equal(await page.locator("#resultsBody b").textContent(), "$100");
  await page.locator(".hours-input").fill("0");
  assert.equal(await page.locator("#payoutTable").isVisible(), false);
  await text(page, "totalTipsEarned", "$0.00");
  await text(page, "paycheckAmount", "$400.00");
});

test("new fields persist after reload and legacy drafts remain compatible", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "pot", "20");
  await fill(page, "creditPot", "10");
  await fill(page, "guestCount", "10");
  await page.reload();
  assert.equal(await page.locator("#creditPot").inputValue(), "$10.00");
  assert.equal(await page.locator("#guestCount").inputValue(), "10");
  await text(page, "paycheckAmount", "$10.00");
  await page.evaluate(() => localStorage.setItem("twobirds-tipout-draft-v1", JSON.stringify({
    pot: "$150", notes: "Legacy draft", staff: [{ role: "Shift Manager", name: "Test Manager", hours: "1" }]
  })));
  await page.reload();
  await text(page, "cashTotal", "$150");
  assert.equal(await page.locator("#combinedResult").isVisible(), false);
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
});

test("send includes optional results, prevents unauthenticated sends, and never auto-sends edits", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "creditPot", "10.43");
  await fill(page, "guestCount", "10");
  const sent = [];
  await page.route("https://script.google.com/**", async route => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { ok: true, replacedRows: 0 } });
  });
  await page.evaluate(() => { detectedVenue = "Ivy House"; });
  await page.locator("#calc").click();
  assert.equal(sent.length, 0);
  assert.match(await page.locator("#sendStatus").textContent(), /session expired/i);
  await page.evaluate(() => {
    document.getElementById("pinGate").style.display = "none";
    authenticatedManagerName = "Test Manager";
    authenticatedManagerToken = "local-test-token";
  });
  await page.locator("#calc").click();
  await page.waitForFunction(() => document.getElementById("sendStatus").textContent === "Receipt sent!");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].totalPot, 0);
  assert.equal(sent[0].creditPot, 10.43);
  assert.equal(sent[0].totalTipsEarned, 10.43);
  assert.equal(sent[0].paycheckDifference, 29.57);
  assert.equal(sent[0].entries[0].creditTipout, 10.43);
  assert.equal(sent[0].paycheckEntries[0].tipout, 29.57);
  await fill(page, "creditPot", "20");
  await text(page, "paycheckAmount", "$20.00");
  assert.equal(sent.length, 1);
  assert.equal(await page.evaluate(() => latestReceipt), null);
});

test("decimal credit tips persist, reconcile uneven shares and reject invalid cents", async t => {
  const page = await openCalculator(t, 390);
  await soloTimeCard(page);
  await page.evaluate(() => addStaff("Bartender", "Second Person", "2", false));
  await fill(page, "pot", "100");
  await fill(page, "creditPot", "252.43");
  await fill(page, "guestCount", "100");
  await text(page, "cashTotal", "$101");
  await text(page, "combinedTotal", "$353.43");
  await text(page, "paycheckAmount", "$46.57");
  const result = await page.evaluate(() => JSON.parse(JSON.stringify(getCurrentCalculation())));
  assert.deepEqual(result.credit.entries.map(entry => entry.tipout), [84.14, 168.29]);
  assert.equal(result.paycheck.entries.reduce((sum, entry) => sum + Math.round(entry.tipout * 100), 0), 4657);
  assert.match(await page.locator("#resultsBody").textContent(), /Credit Tips: \$84.14/);
  await page.reload();
  assert.equal(await page.locator("#creditPot").inputValue(), "$252.43");
  await text(page, "combinedTotal", "$353.43");
  await page.evaluate(() => {
    document.getElementById("pinGate").style.display = "none";
    document.body.classList.remove("pin-gate-active");
    document.body.style.overflow = "";
  });
  await fill(page, "creditPot", "1.234");
  assert.equal(await page.locator("#creditError").isVisible(), true);
  await page.locator("#calc").click();
  assert.match(await page.locator("#sendStatus").textContent(), /two decimal places/);
  await fill(page, "creditPot", "100");
  await page.locator("#creditPot").blur();
  assert.equal(await page.locator("#creditPot").inputValue(), "$100.00");
  assert.equal(await page.locator("#creditError").isVisible(), false);
});

test("mobile results stay readable, cash is primary, and summaries do not overflow", async t => {
  const page = await openCalculator(t, 390);
  await soloTimeCard(page);
  await fill(page, "pot", "150");
  await fill(page, "creditPot", "75");
  await fill(page, "guestCount", "100");
  for (const width of [320, 390, 720]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    const layout = await page.evaluate(() => {
      const cash = getComputedStyle(document.querySelector(".cash-total"));
      const credit = getComputedStyle(document.querySelector("#combinedResult"));
      const ids = ["pot", "creditPot", "guestCount", "tipSummary", "guaranteeSection"];
      const results = [...document.querySelectorAll("#resultsBody td, #paycheckBody td")].map(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      });

      return {
        cashSize: parseFloat(cash.fontSize), creditSize: parseFloat(credit.fontSize),
        cashWeight: Number(cash.fontWeight), creditWeight: Number(credit.fontWeight),
        bounds: ids.map(id => {
          const el = document.getElementById(id);
          const rect = el.getBoundingClientRect();
          return { id, left: rect.left, right: rect.right, width: el.clientWidth, scroll: el.scrollWidth };
        }),
        results, viewport: window.innerWidth, documentWidth: document.documentElement.scrollWidth
      };
    });
    assert.ok(layout.cashSize > layout.creditSize);
    assert.ok(layout.cashWeight > layout.creditWeight);
    assert.ok(layout.documentWidth <= width, `page overflow at ${width}`);
    for (const result of layout.results) {
      assert.ok(result.left >= 0 && result.right <= width, `payout clipped at ${width}`);
    }
    for (const bound of layout.bounds) {
      assert.ok(bound.left >= 0 && bound.right <= layout.viewport, `${bound.id} bounds at ${width}`);
      assert.ok(bound.scroll <= bound.width + 1, `${bound.id} overflow at ${width}`);
    }
  }
});

test("personal earnings require Will's server profile and remain hidden for other accounts", async t => {
  const page = await openCalculator(t, 390);
  await page.evaluate(() => {
    document.getElementById("staffBody").innerHTML = "";
    addStaff("Shift Manager", "Will Schreiner", "5", false);
  });
  await fill(page, "pot", "100");
  await fill(page, "creditPot", "50");
  assert.equal(await page.locator("#personalEarnings").isVisible(), false);
  await page.evaluate(() => {
    authenticatedManagerName = "Will Schreiner";
    authenticatedManagerToken = "test-session";
    updateResults();
  });
  assert.equal(await page.locator("#personalEarnings").isVisible(), false);
  await page.route("https://script.google.com/**", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: {
      ok: true, valid: true,
      personalEarningsProfile: request.managerName === "Will Schreiner" ? {
        owner: "Will Schreiner", hourlyRate: 15, withholdingRate: 0.2074821353509878
      } : null
    } });
  });
  await page.evaluate(async () => {
    await validateManagerSession(authenticatedManagerName, authenticatedManagerToken);
    updateResults();
  });
  assert.equal(await page.locator("#personalEarnings").isVisible(), true);
  await text(page, "personalWages", "$75.00");
  await text(page, "personalTips", "$150.00");
  await text(page, "personalBaseGross", "$225.00");
  await text(page, "personalBaseTax", "$46.68");
  await text(page, "personalBaseNet", "$178.32");
  await text(page, "personalBaseHourly", "$45.00/hr");
  await text(page, "personalBaseHourlyNet", "$35.66/hr");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  assert.equal(await page.locator("#personalMinimumStatus").isVisible(), false);
  assert.match(await page.locator("#personalMinimumHelp").textContent(), /Number of Guests/);
  await text(page, "personalGross", "$225.00");
  await text(page, "personalTax", "$46.68");
  await text(page, "personalNet", "$178.32");
  await fill(page, "guestCount", "100");
  await text(page, "personalGuarantee", "$250.00");
  await text(page, "personalMinimumStatus", "Below minimum - extra pay is owed.");
  assert.equal(await page.locator("#personalMinimumStatus").getAttribute("class"), "minimum-status below");
  assert.equal(await page.locator("#personalMinimumStatus").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(254, 242, 242)");
  await text(page, "personalGross", "$475.00");
  await text(page, "personalHourly", "$95.00/hr");
  await text(page, "personalHourlyNet", "$75.29/hr");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), true);
  await text(page, "personalBaseGross", "$225.00");
  await page.locator(".hours-input").fill("4");
  await text(page, "personalWages", "$60.00");
  await text(page, "personalGross", "$460.00");
  await text(page, "personalBaseGross", "$210.00");
  await text(page, "personalBaseHourly", "$52.50/hr");
  await text(page, "personalHourly", "$115.00/hr");
  await fill(page, "guestCount", "10");
  await text(page, "personalGross", "$210.00");
  await text(page, "personalBaseGross", "$210.00");
  await text(page, "personalGuarantee", "$0.00");
  await text(page, "personalMinimumStatus", "Minimum met - no extra pay needed.");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  assert.equal(await page.locator("#personalMinimumHelp").isVisible(), false);
  assert.equal(await page.locator("#personalBaseGross").isVisible(), true);
  assert.equal(await page.locator("#personalMinimumStatus").getAttribute("class"), "minimum-status met");
  assert.equal(await page.locator("#personalMinimumStatus").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(240, 253, 244)");
  await fill(page, "guestCount", "40");
  await fill(page, "pot", "110");
  await text(page, "personalMinimumStatus", "Minimum met - no extra pay needed.");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  await fill(page, "pot", "100");
  await text(page, "personalMinimumStatus", "Below minimum - extra pay is owed.");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), true);
  assert.equal(await page.locator("#personalMinimumHelp").isVisible(), true);
  await fill(page, "guestCount", "37.5");
  assert.equal(await page.locator("#personalMinimumStatus").isVisible(), false);
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  await fill(page, "guestCount", "0");
  await text(page, "personalMinimumStatus", "Minimum met - no extra pay needed.");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  await fill(page, "guestCount", "");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  assert.equal(await page.locator("#personalMinimumStatus").isVisible(), false);
  assert.equal(await page.locator("#personalMinimumHelp").isVisible(), true);
  await page.locator("#staffBody input").first().fill("Another Person");
  assert.equal(await page.locator("#personalEarningsValues").isVisible(), false);
  assert.match(await page.locator("#personalEarningsHelp").textContent(), /Add Will Schreiner/);
  await page.locator("#staffBody input").first().fill("Will Schreiner");
  assert.equal(await page.locator("#personalEarningsValues").isVisible(), true);
  const bounds = await page.locator("#personalEarnings").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390);
  const draft = await page.evaluate(() => getDraft());
  assert.equal(draft.personalEarningsProfile, undefined);
  assert.equal(draft.withholdingRate, undefined);
  await page.evaluate(() => clearManagerSessionStorage());
  assert.equal(await page.locator("#personalEarnings").isVisible(), false);
  await text(page, "personalNet", "");
  await text(page, "personalHourly", "");
  await page.evaluate(async () => {
    authenticatedManagerName = "Another Manager";
    authenticatedManagerToken = "another-session";
    await validateManagerSession(authenticatedManagerName, authenticatedManagerToken);
    updateResults();
  });
  assert.equal(await page.locator("#personalEarnings").isVisible(), false);
});

test("Renee sees role-specific wages and downloads her own PDF earnings receipt", async t => {
  const page = await openCalculator(t, 390);
  await page.route("https://script.google.com/**", async route => {
    const request = route.request().postDataJSON();
    await route.fulfill({ json: {
      ok: true, valid: true,
      personalEarningsProfile: request.managerName === "Renee Ehlers" ? {
        owner: "Renee Ehlers",
        roleRates: { Bartender: 12, "Shift Manager": 14 },
        withholdingRate: 0.2074821353509878
      } : null
    } });
  });
  await page.evaluate(async () => {
    authenticatedManagerName = "Renee Ehlers";
    authenticatedManagerToken = "test-renee-session";
    await validateManagerSession(authenticatedManagerName, authenticatedManagerToken);
    document.getElementById("staffBody").innerHTML = "";
    addStaff("Bartender", "Renee Ehlers", "3", false);
    addStaff("Shift Manager", "Renee Ehlers", "2", false);
    addStaff("Bartender", "Someone Else", "1", false);
    document.getElementById("venueSelect").value = "Ivy House";
    detectedVenue = "Ivy House";
  });
  assert.equal(await page.locator("#personalEarnings").isVisible(), true);
  assert.match(await page.locator("#personalEarningsTitle").textContent(), /Renee Ehlers/);
  assert.match(await page.locator("#personalEarningsHelp").textContent(), /3 hours at \$12\.00\/hour/);
  assert.match(await page.locator("#personalEarningsHelp").textContent(), /2 hours at \$14\.00\/hour/);
  await fill(page, "creditPot", "100");
  await fill(page, "guestCount", "100");
  await text(page, "personalWages", "$64.00");
  await text(page, "personalTips", "$83.33");
  await text(page, "personalGuarantee", "$250.00");
  await text(page, "personalGross", "$397.33");
  await text(page, "personalNet", "$314.89");
  await text(page, "personalHourly", "$79.47/hr");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  const pending = page.waitForEvent("download");
  await page.locator("#downloadPersonalEarnings").click();
  const download = await pending;
  assert.match(download.suggestedFilename(), /^renee-ehlers-earnings-.*-ivy-house\.pdf$/);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: new Uint8Array(Buffer.concat(chunks)), useSystemFonts: true }).promise;
  try {
    assert.equal(pdf.numPages, 1);
    const content = await (await pdf.getPage(1)).getTextContent();
    const labels = content.items.filter(item => item.str.trim()).map(item => item.str);
    assert.ok(labels.includes("Renee Ehlers"));
    assert.ok(labels.includes("$397.33"));
    assert.ok(labels.includes("$314.89"));
    assert.ok(labels.includes("$79.47/hr"));
    assert.ok(labels.includes("$250.00"));
    assert.ok(!labels.some(label => /Will Schreiner|Without Tip Minimum|With Tip Minimum/.test(label)));
  } finally {
    await pdf.destroy();
    await download.delete();
  }
});

test("Will can save a one-page earnings PDF with exact totals and native file sharing", async t => {
  const page = await openCalculator(t, 320);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
  });
  let requests = 0;
  await page.route("https://script.google.com/**", async route => {
    requests++;
    await route.fulfill({ json: {
      ok: true, valid: true,
      personalEarningsProfile: { owner: "Will Schreiner", hourlyRate: 15, withholdingRate: 0.2074821353509878 }
    } });
  });
  await page.evaluate(async () => {
    authenticatedManagerName = "Will Schreiner";
    authenticatedManagerToken = "test-session";
    await validateManagerSession(authenticatedManagerName, authenticatedManagerToken);
    document.getElementById("staffBody").innerHTML = "";
    addStaff("Shift Manager", "Will Schreiner", "5", false);
    document.getElementById("pinGate").style.display = "grid";
    startPostPinVenueFlow(authenticatedManagerName);
  });
  await page.locator("#venueGateButtons button").first().click();
  await page.waitForFunction(() => document.getElementById("pinGate").style.display === "none");
  await page.locator("#venueSelect").selectOption("Ivy House");
  await fill(page, "pot", "100");
  await fill(page, "creditPot", "50");
  const downloads = [];
  page.on("download", download => downloads.push(download));
  async function downloadReceipt() {
    const pending = page.waitForEvent("download");
    await page.locator("#downloadPersonalEarnings").click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.subarray(0, 8).toString(), "%PDF-1.4");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await loading.promise;
    assert.equal(pdf.numPages, 1);
    const pdfPage = await pdf.getPage(1);
    const content = await pdfPage.getTextContent();
    const labels = content.items.filter(item => item.str.trim()).map(item => item.str);
    const text = labels.join("\n");
    assert.equal(labels.filter(label => label === "Will Schreiner").length, 1);
    assert.equal(labels.filter(label => label === "TOTAL EARNED BEFORE TAX").length, 1);
    assert.match(text, /TwoBirds/);
    assert.match(text, /EVENT EARNINGS/);
    assert.match(text, /Cash tips/);
    assert.match(text, /Credit tips/);
    assert.match(text, /Hourly wages/);
    assert.match(text, /5 hours/);
    assert.match(text, /estimate, not a paycheck deposit/);
    assert.match(text, /Includes cash tips already received/);
    assert.doesNotMatch(text, /Without Tip Minimum|With Tip Minimum|Withholding|Guests|Not calculated/);
    const amounts = content.items.filter(item => item.str.startsWith("$"));
    const biggest = amounts.reduce((largest, item) => item.height > largest.height ? item : largest);
    assert.equal(biggest.str, labels[labels.indexOf("TOTAL EARNED BEFORE TAX") + 1]);
    for (const item of content.items.filter(item => item.str)) {
      assert.ok(item.transform[4] >= 0 && item.transform[4] + item.width <= 432, `PDF text fits: ${item.str}`);
      assert.ok(item.transform[5] > 0 && item.transform[5] < 648);
    }
    await pdf.destroy();
    const date = await page.evaluate(() => todayLocalISO());
    assert.equal(download.suggestedFilename(), `will-schreiner-earnings-${date}-ivy-house.pdf`);
    assert.match(text, new RegExp(date));
    assert.match(text, /Ivy House/);
    await download.delete();
    return text;
  }
  let receipt = await downloadReceipt();
  assert.match(receipt, /\$225\.00/);
  assert.match(receipt, /\$178\.32/);
  assert.match(receipt, /\$45\.00\/hr/);
  assert.match(receipt, /Cash tips\n\$100\nCredit tips\n\$50\.00\nHourly wages\n\$75\.00/);
  assert.doesNotMatch(receipt, /Paycheck guarantee added/);
  await fill(page, "guestCount", "100");
  receipt = await downloadReceipt();
  assert.match(receipt, /\$475\.00/);
  assert.match(receipt, /\$376\.45/);
  assert.match(receipt, /\$95\.00\/hr/);
  assert.match(receipt, /Paycheck guarantee added\n\$250\.00/);
  const hierarchy = await page.evaluate(() => ({
    hourly: parseFloat(getComputedStyle(document.getElementById("personalHourly")).fontSize),
    total: parseFloat(getComputedStyle(document.getElementById("personalGross")).fontSize)
  }));
  assert.ok(hierarchy.total > hierarchy.hourly && hierarchy.hourly >= 24);
  for (const width of [320, 390, 720]) {
    await page.setViewportSize({ width, height: 900 });
    for (const id of ["personalBaseHourly", "personalHourly", "personalGross", "personalNet"]) {
      const bounds = await page.locator(`#${id}`).boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${id} fits at ${width}`);
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await fill(page, "guestCount", "0");
  receipt = await downloadReceipt();
  assert.match(receipt, /\$225\.00/);
  assert.doesNotMatch(receipt, /Paycheck guarantee added/);
  await page.evaluate(() => {
    globalThis.sharedEarningsFiles = [];
    Object.defineProperty(navigator, "canShare", { configurable: true, value: data =>
      data.files.length === 1 && data.files[0] instanceof File && data.files[0].type === "application/pdf"
    });
    Object.defineProperty(navigator, "share", { configurable: true, writable: true, value: async data => {
      globalThis.sharedEarningsFiles.push({
        name: data.files[0].name, content: await data.files[0].text(),
        userActivated: navigator.userActivation.isActive
      });
    } });
  });
  await page.locator("#downloadPersonalEarnings").click();
  await page.waitForFunction(() => document.getElementById("personalDownloadStatus").textContent.includes("Share menu closed"));
  const shared = await page.evaluate(() => globalThis.sharedEarningsFiles[0]);
  assert.match(shared.name, /^will-schreiner-earnings-.*-ivy-house\.pdf$/);
  assert.match(shared.content, /^%PDF-1.4/);
  assert.equal(shared.userActivated, true);
  assert.equal(downloads.length, 3, "sharing must not also download");
  await page.evaluate(() => {
    navigator.share = async () => { throw new DOMException("Canceled", "AbortError"); };
  });
  await page.locator("#downloadPersonalEarnings").click();
  await text(page, "personalDownloadStatus", "Save canceled. Tap Save Earnings to try again.");
  assert.equal(await page.locator("#downloadPersonalEarningsFallback").isVisible(), true);
  await page.evaluate(() => {
    navigator.share = async () => { throw new DOMException("Not allowed", "NotAllowedError"); };
  });
  await page.locator("#downloadPersonalEarnings").click();
  assert.match(await page.locator("#personalDownloadStatus").textContent(), /Tap Download Instead/);
  const fallbackDownload = page.waitForEvent("download");
  await page.locator("#downloadPersonalEarningsFallback").click();
  await (await fallbackDownload).delete();
  assert.equal(downloads.length, 4);
  assert.equal(await page.locator("#downloadPersonalEarningsFallback").isVisible(), false);
  await page.evaluate(() => {
    delete navigator.share;
    delete navigator.canShare;
  });
  await fill(page, "guestCount", "-1");
  await page.locator("#downloadPersonalEarnings").click();
  assert.match(await page.locator("#personalDownloadStatus").textContent(), /fix any guest-count error/);
  assert.equal(downloads.length, 4);
  await fill(page, "guestCount", "");
  const bounds = await page.locator("#downloadPersonalEarnings").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await page.locator("#staffBody input").first().fill("Another Person");
  assert.equal(await page.locator("#downloadPersonalEarnings").isVisible(), false);
  await page.evaluate(() => downloadPersonalEarnings());
  assert.equal(downloads.length, 4);
  await page.evaluate(() => clearManagerSessionStorage());
  assert.equal(await page.locator("#downloadPersonalEarnings").isVisible(), false);
  await page.evaluate(() => {
    authenticatedManagerName = "Another Manager";
    authenticatedManagerToken = "another-session";
    updateResults();
    downloadPersonalEarnings();
  });
  assert.equal(downloads.length, 4);
  assert.equal(requests, 1, "downloads must not call the backend or send receipts");
});

test("venue entry and switching make no network requests and preserve manual time cards", async t => {
  const page = await openCalculator(t);
  const requests = [];
  await page.route("https://script.google.com/**", async route => {
    requests.push(route.request().postDataJSON());
    await route.abort();
  });
  await soloTimeCard(page);
  await page.evaluate(() => {
    authenticatedManagerName = "Test Manager";
    authenticatedManagerToken = "test-token";
    document.getElementById("pinGate").style.display = "grid";
    startPostPinVenueFlow(authenticatedManagerName);
  });
  const start = Date.now();
  await page.locator("#venueGateButtons button").first().click();
  await page.waitForFunction(() => !document.body.classList.contains("pin-gate-active"), { timeout: 2000 });
  assert.ok(Date.now() - start < 2000, "venue access must not wait for a network request");
  await page.waitForFunction(() => document.getElementById("pinGate").style.display === "none");
  await page.locator("#venueSelect").selectOption("Starling");
  await page.waitForTimeout(300);
  assert.deepEqual(requests, []);
  assert.equal(await page.locator("#staffBody input").first().inputValue(), "Test Manager");
  assert.equal(await page.locator(".hours-input").inputValue(), "1");
  assert.equal(await page.locator("#sendStatus").textContent(), "");
});

test("authentication requests retain a bounded timeout", async t => {
  const page = await openCalculator(t);
  await fill(page, "pot", "100");
  assert.equal(await page.locator("#pot").inputValue(), "$100");
  const timeoutMessage = await page.evaluate(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    });
    try {
      await postToAppsScript(RECEIPT_ENDPOINT, { action: "authManagerPin" }, { timeoutMs: 30 });
      return "unexpected success";
    } catch (error) {
      return error.message;
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  assert.match(timeoutMessage, /taking too long/);
});
