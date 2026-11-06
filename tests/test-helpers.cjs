const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function loadCalculations() {
  const context = vm.createContext({});
  const helpers = script.slice(script.indexOf("function calculateTipPool("), script.indexOf("const VENUES"));
  vm.runInContext(helpers, context);
  return context;
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
  }
  getName() { return this.name; }
  setName(name) { this.name = name; return this; }
  getLastRow() { return this.rows.length; }
  setFrozenRows() { return this; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
  getRange(row, column, numRows, numColumns) {
    const sheet = this;
    return {
      setNumberFormat() { return this; },
      setValues(values) {
        values.forEach((rowValues, rowOffset) => {
          while (sheet.rows.length < row + rowOffset) sheet.rows.push([]);
          rowValues.forEach((value, columnOffset) => {
            sheet.rows[row + rowOffset - 1][column + columnOffset - 1] = value;
          });
        });
        return this;
      },
      getValues() {
        return Array.from({ length: numRows }, (_, rowOffset) =>
          Array.from({ length: numColumns }, (__, columnOffset) => {
            const value = (sheet.rows[row + rowOffset - 1] || [])[column + columnOffset - 1];
            return value === undefined ? "" : value;
          })
        );
      }
    };
  }
}

class FakeSpreadsheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.sheets = [new FakeSheet("Sheet1")];
  }
  getId() { return this.id; }
  getSheets() { return this.sheets; }
  getSheetByName(name) { return this.sheets.find(sheet => sheet.name === name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
}

function loadBackend({ properties = new Map(), spreadsheets = [], connectEarnings = true } = {}) {
  let uuid = 0;
  if (connectEarnings && !properties.has("WILLS_EARNINGS_SPREADSHEET_ID")) {
    const data = new FakeSpreadsheet("Will's Earnings - Private Data", `earnings-${spreadsheets.length + 1}`);
    spreadsheets.push(data);
    properties.set("WILLS_EARNINGS_SPREADSHEET_ID", data.id);
    properties.set("WILLS_EARNINGS_URL", "https://script.google.com/macros/s/test-earnings-site/exec");
  }
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: text => ({ text, setMimeType() { return this; } })
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.has(key) ? properties.get(key) : null,
        setProperty: (key, value) => properties.set(key, String(value)),
        deleteProperty: key => properties.delete(key),
        getProperties: () => Object.fromEntries(properties)
      })
    },
    SpreadsheetApp: {
      create: name => {
        const spreadsheet = new FakeSpreadsheet(name, `sheet-${spreadsheets.length + 1}`);
        spreadsheets.push(spreadsheet);
        return spreadsheet;
      },
      openById: id => {
        const spreadsheet = spreadsheets.find(item => item.id === id);
        if (!spreadsheet) throw new Error(`Missing spreadsheet ${id}`);
        return spreadsheet;
      }
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`,
      DigestAlgorithm: { SHA_256: "sha256" },
      computeDigest: (_, value) => [...require("node:crypto").createHash("sha256").update(value).digest()],
      base64EncodeWebSafe: bytes => Buffer.from(bytes).toString("base64url")
    }
  });
  vm.runInContext(fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8"), context);
  const post = payload => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
  const earningsData = () => spreadsheets.find(item => item.id === properties.get("WILLS_EARNINGS_SPREADSHEET_ID"));
  return { context, post, properties, spreadsheets, earningsData };
}

module.exports = { root, html, script, loadCalculations, loadBackend, FakeSpreadsheet };
