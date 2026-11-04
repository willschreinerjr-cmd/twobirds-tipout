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

function loadReceiptHelpers() {
  const source = fs.readFileSync(path.join(root, "google-apps-script.gs"), "utf8");
  const helpers = source.slice(source.indexOf("function moneyWhole("), source.indexOf("function ", source.indexOf("function normalizePersonName(") + 10));
  const context = vm.createContext({});
  vm.runInContext(helpers, context);
  return context;
}

module.exports = { root, html, script, loadCalculations, loadReceiptHelpers };
