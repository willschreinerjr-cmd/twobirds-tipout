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

test("live cash, credit, guests, exceeded minimum, and optional-field clearing", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "pot", "150");
  await text(page, "cashTotal", "$150.00");
  assert.equal(await page.locator("#combinedResult").isVisible(), false);
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
  assert.equal(await page.locator("#resultsBody b").textContent(), "$150");
  await fill(page, "creditPot", "75");
  await text(page, "combinedTotal", "$225.00");
  await text(page, "cashTotal", "$150.00");
  await fill(page, "guestCount", "100");
  await text(page, "guaranteedMinimum", "$400.00");
  await text(page, "totalTipsEarned", "$225.00");
  await text(page, "paycheckAmount", "$175.00");
  assert.equal(await page.locator("#paycheckBody td").last().textContent(), "$175.00");
  await fill(page, "pot", "400");
  await text(page, "paycheckAmount", "$0.00");
  assert.equal(await page.locator("#guaranteeMet").isVisible(), true);
  await fill(page, "pot", "");
  await text(page, "cashTotal", "$0.00");
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
  assert.equal(await page.locator("#resultsBody b").nth(0).textContent(), "$33");
  assert.equal(await page.locator("#resultsBody b").nth(1).textContent(), "$66");
  await text(page, "totalTipsEarned", "$198.00");
  await text(page, "paycheckAmount", "$202.00");
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
  assert.equal(await page.locator("#creditPot").inputValue(), "$10");
  assert.equal(await page.locator("#guestCount").inputValue(), "10");
  await text(page, "paycheckAmount", "$10.00");
  await page.evaluate(() => localStorage.setItem("twobirds-tipout-draft-v1", JSON.stringify({
    pot: "$150", notes: "Legacy draft", staff: [{ role: "Shift Manager", name: "Test Manager", hours: "1" }]
  })));
  await page.reload();
  await text(page, "cashTotal", "$150.00");
  assert.equal(await page.locator("#combinedResult").isVisible(), false);
  assert.equal(await page.locator("#guaranteeSection").isVisible(), false);
});

test("send includes optional results, prevents unauthenticated sends, and never auto-sends edits", async t => {
  const page = await openCalculator(t);
  await soloTimeCard(page);
  await fill(page, "creditPot", "10");
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
  assert.equal(sent[0].creditPot, 10);
  assert.equal(sent[0].totalTipsEarned, 10);
  assert.equal(sent[0].paycheckDifference, 30);
  assert.equal(sent[0].entries[0].creditTipout, 10);
  assert.equal(sent[0].paycheckEntries[0].tipout, 30);
  await fill(page, "creditPot", "20");
  await text(page, "paycheckAmount", "$20.00");
  assert.equal(sent.length, 1);
  assert.equal(await page.evaluate(() => latestReceipt), null);
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
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
  assert.match(await page.locator("#personalMinimumHelp").textContent(), /Number of Guests/);
  await text(page, "personalGross", "$225.00");
  await text(page, "personalTax", "$46.68");
  await text(page, "personalNet", "$178.32");
  await fill(page, "guestCount", "100");
  await text(page, "personalGuarantee", "$250.00");
  await text(page, "personalGross", "$475.00");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), true);
  await text(page, "personalBaseGross", "$225.00");
  await page.locator(".hours-input").fill("4");
  await text(page, "personalWages", "$60.00");
  await text(page, "personalGross", "$460.00");
  await text(page, "personalBaseGross", "$210.00");
  await fill(page, "guestCount", "10");
  await text(page, "personalGross", "$210.00");
  await text(page, "personalBaseGross", "$210.00");
  await text(page, "personalGuarantee", "$0.00");
  await fill(page, "guestCount", "");
  assert.equal(await page.locator("#personalMinimumValues").isVisible(), false);
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
  await page.evaluate(async () => {
    authenticatedManagerName = "Another Manager";
    authenticatedManagerToken = "another-session";
    await validateManagerSession(authenticatedManagerName, authenticatedManagerToken);
    updateResults();
  });
  assert.equal(await page.locator("#personalEarnings").isVisible(), false);
});

test("Will can download current personal earnings comparisons without sending a receipt", async t => {
  const page = await openCalculator(t, 320);
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
  async function downloadRows() {
    const pending = page.waitForEvent("download");
    await page.locator("#downloadPersonalEarnings").click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const csv = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
    const rows = csv.trimEnd().split("\r\n").map(line => line.slice(1, -1).split('","'));
    assert.equal(rows.length, 3);
    rows.forEach(row => assert.equal(row.length, 16));
    const date = await page.evaluate(() => todayLocalISO());
    assert.equal(download.suggestedFilename(), `will-schreiner-earnings-${date}-ivy-house.csv`);
    assert.deepEqual(rows[1].slice(0, 7), [date, "Ivy House", "Will Schreiner", "5", "15.00", "75.00", "150.00"]);
    assert.match(rows[1][15], /not an exact payroll calculation/);
    await download.delete();
    return rows;
  }
  let rows = await downloadRows();
  assert.deepEqual(rows[1].slice(9, 15), ["Without Tip Minimum", "0.00", "225.00", "46.68", "178.32", "20.75%"]);
  assert.deepEqual(rows[2].slice(10, 14), ["", "", "", ""]);
  assert.match(rows[2][15], /Not calculated/);
  await fill(page, "guestCount", "100");
  rows = await downloadRows();
  assert.deepEqual(rows[2].slice(7, 14), ["100", "400.00", "With Tip Minimum", "250.00", "475.00", "98.55", "376.45"]);
  await fill(page, "guestCount", "0");
  rows = await downloadRows();
  assert.deepEqual(rows[2].slice(10, 14), ["0.00", "225.00", "46.68", "178.32"]);
  await fill(page, "guestCount", "-1");
  await page.locator("#downloadPersonalEarnings").click();
  assert.match(await page.locator("#personalDownloadStatus").textContent(), /correct any guest-count error/);
  assert.equal(downloads.length, 3);
  await fill(page, "guestCount", "");
  const bounds = await page.locator("#downloadPersonalEarnings").boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 320);
  await page.locator("#staffBody input").first().fill("Another Person");
  assert.equal(await page.locator("#downloadPersonalEarnings").isVisible(), false);
  await page.evaluate(() => downloadPersonalEarnings());
  assert.equal(downloads.length, 3);
  await page.evaluate(() => clearManagerSessionStorage());
  assert.equal(await page.locator("#downloadPersonalEarnings").isVisible(), false);
  await page.evaluate(() => {
    authenticatedManagerName = "Another Manager";
    authenticatedManagerToken = "another-session";
    updateResults();
    downloadPersonalEarnings();
  });
  assert.equal(downloads.length, 3);
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
