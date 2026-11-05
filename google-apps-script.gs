const AUTH_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const AUTH_SESSION_KEY_PREFIX = "managerAuthSession:";
const MANAGER_PINS = {
  "1218": "Will Schreiner",
  "0424": "Olivia Bartels",
  "5097": "Ashley Brunette",
  "8707": "Avery Diercks",
  "0087": "Julianne Dollard",
  "1212": "Renee Ehlers",
  "2112": "Sal Gauthier",
  "8167": "Jesse Hertzke",
  "8121": "JJ Ingrassia",
  "3805": "Alex Kerkman",
  "5596": "Lacey Kremer",
  "1290": "Ben McGill",
  "2334": "Jake Faapito"
};

function createJsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function createAuthToken() {
  const nonce = Utilities.getUuid().replace(/-/g, "");
  const seed = `${Date.now()}-${Math.random()}-${nonce}`;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, "");
}

function authSessionPropertyKey(token) {
  return `${AUTH_SESSION_KEY_PREFIX}${token}`;
}

function createManagerSession(managerName) {
  const cleanName = String(managerName || "").trim();
  if (!cleanName) {
    throw new Error("Manager name is required for auth session.");
  }

  const token = createAuthToken();
  const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
  const payload = JSON.stringify({ managerName: cleanName, expiresAt });
  PropertiesService.getScriptProperties().setProperty(authSessionPropertyKey(token), payload);
  return { authToken: token, expiresAt };
}

function readManagerSession(token) {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return null;

  const key = authSessionPropertyKey(cleanToken);
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    return null;
  }

  const expiresAt = Number(parsed && parsed.expiresAt);
  const managerName = String(parsed && parsed.managerName || "").trim();
  if (!managerName || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    return null;
  }

  return { managerName, expiresAt };
}

function validateManagerSession(managerName, authToken) {
  const cleanName = String(managerName || "").trim();
  const session = readManagerSession(authToken);
  if (!session || !cleanName) return false;
  return session.managerName.toLowerCase() === cleanName.toLowerCase();
}

function requireValidManagerAuth(payload) {
  const managerName = String(payload && payload.managerName || "").trim();
  const authToken = String(payload && payload.authToken || "").trim();
  if (!managerName || !authToken || !validateManagerSession(managerName, authToken)) {
    throw new Error("Invalid auth session. Please re-enter manager PIN.");
  }
  return managerName;
}

function getPersonalEarningsProfile(managerName) {
  const cleanName = String(managerName || "").trim().toLowerCase();
  const profiles = {
    "will schreiner": {
      owner: "Will Schreiner",
      hourlyRate: 15,
      withholdingRate: 0.2074821353509878
    },
    "renee ehlers": {
      owner: "Renee Ehlers",
      roleRates: { Bartender: 12, "Shift Manager": 14 },
      withholdingRate: 0.2074821353509878
    }
  };
  return profiles[cleanName] || null;
}

const EARNINGS_TRACKER_OWNER = "Will Schreiner";
const TRACKER_SPREADSHEET_PROPERTY = "EARNINGS_TRACKER_SPREADSHEET_ID";
const TRACKER_SPREADSHEET_NAME = "TwoBirds Tipout - Private Earnings Tracker";
const PAY_PERIOD_ANCHOR = "2026-10-12";
const PAY_PERIOD_DAYS = 14;
const MAX_TRACKER_AMOUNT = 100000;
const SHIFT_SHEET = "Shifts";
const PAYCHECK_SHEET = "Paychecks";
const SHIFT_COLUMNS = [
  "id", "shiftDate", "venue", "hours", "wages", "cashTips", "creditTips",
  "tipMinimum", "gross", "tax", "net", "savedAt", "updatedAt"
];
const PAYCHECK_COLUMNS = ["periodStart", "actualPaycheck", "updatedAt"];

function isEarningsTrackerOwner(managerName) {
  return String(managerName || "").trim().toLowerCase() === EARNINGS_TRACKER_OWNER.toLowerCase();
}

function getEarningsTrackerAccess(managerName) {
  return isEarningsTrackerOwner(managerName) ? { earningsTracker: true } : {};
}

function requireEarningsTrackerOwner(payload) {
  const managerName = requireValidManagerAuth(payload);
  // Other accounts get the same response as an unsupported action, revealing nothing.
  if (!isEarningsTrackerOwner(managerName)) {
    throw new Error("Unsupported action.");
  }
  return managerName;
}

function roundCents(value) {
  return Math.round(Number(value) * 100) / 100;
}

function isoDateToDayNumber(isoDate) {
  const match = String(isoDate || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const time = Date.UTC(year, month - 1, day);
  const check = new Date(time);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null;
  }
  return Math.round(time / 86400000);
}

function isPayPeriodStart(isoDate) {
  const day = isoDateToDayNumber(isoDate);
  if (day === null) return false;
  const offset = day - isoDateToDayNumber(PAY_PERIOD_ANCHOR);
  return ((offset % PAY_PERIOD_DAYS) + PAY_PERIOD_DAYS) % PAY_PERIOD_DAYS === 0;
}

function parseTrackerAmount(value, label) {
  const number = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(number) ||
      number < 0 || number > MAX_TRACKER_AMOUNT) {
    throw new Error(`${label} must be a nonnegative amount.`);
  }
  return roundCents(number);
}

function buildTrackerShift(input, hourlyRate, withholdingRate) {
  const shiftDate = String(input && input.shiftDate || "").trim();
  if (isoDateToDayNumber(shiftDate) === null) {
    throw new Error("Enter a valid shift date.");
  }
  const venue = String(input && input.venue || "").trim().slice(0, 60);
  if (!venue) {
    throw new Error("Select a venue before saving your shift.");
  }
  const hours = Number(input && input.hours);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) {
    throw new Error("Hours must be greater than 0 and no more than 24.");
  }
  const cashTips = parseTrackerAmount(input.cashTips, "Cash tips");
  const creditTips = parseTrackerAmount(input.creditTips, "Credit tips");
  const tipMinimum = parseTrackerAmount(input.tipMinimum, "Tip minimum");
  // Matches calculatePersonalEarnings in index.html so saved totals equal the on-screen totals.
  const wages = roundCents(hours * hourlyRate);
  const tips = roundCents(cashTips + creditTips);
  const gross = roundCents(wages + tips + tipMinimum);
  const tax = roundCents(gross * withholdingRate);
  const net = roundCents(gross - tax);
  return { shiftDate, venue, hours, wages, cashTips, creditTips, tipMinimum, gross, tax, net };
}

function getTrackerSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty(TRACKER_SPREADSHEET_PROPERTY);
  if (existingId) return SpreadsheetApp.openById(existingId);

  // Created in the deploying account's Drive and not shared with anyone.
  const spreadsheet = SpreadsheetApp.create(TRACKER_SPREADSHEET_NAME);
  props.setProperty(TRACKER_SPREADSHEET_PROPERTY, spreadsheet.getId());
  return spreadsheet;
}

function getTrackerSheet(spreadsheet, name, columns) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    const sheets = spreadsheet.getSheets();
    const unusedDefault = sheets.length === 1 && sheets[0].getLastRow() === 0 &&
      sheets[0].getName() !== SHIFT_SHEET && sheets[0].getName() !== PAYCHECK_SHEET;
    sheet = unusedDefault ? sheets[0].setName(name) : spreadsheet.insertSheet(name);
  }
  if (sheet.getLastRow() === 0) {
    writeTrackerRow(sheet, 1, columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function writeTrackerRow(sheet, row, values) {
  // Plain-text cells keep dates and cents exactly as saved.
  sheet.getRange(row, 1, 1, values.length)
    .setNumberFormat("@")
    .setValues([values.map(value => value === null || value === undefined ? "" : String(value))]);
}

function readTrackerRows(sheet, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, columns.length).getValues().map((values, index) => {
    const record = { row: index + 2 };
    columns.forEach((column, columnIndex) => { record[column] = String(values[columnIndex]); });
    return record;
  });
}

function toTrackerShift(record) {
  const shift = { id: record.id, shiftDate: record.shiftDate, venue: record.venue,
    savedAt: record.savedAt, updatedAt: record.updatedAt };
  ["hours", "wages", "cashTips", "creditTips", "tipMinimum", "gross", "tax", "net"].forEach(key => {
    shift[key] = Number(record[key]) || 0;
  });
  return shift;
}

function shiftToRow(shift) {
  return SHIFT_COLUMNS.map(column => shift[column]);
}

function sameShiftSlot(record, shiftDate, venue) {
  return record.shiftDate === shiftDate && record.venue.trim().toLowerCase() === venue.trim().toLowerCase();
}

function listEarningsTracker(spreadsheet) {
  const shifts = readTrackerRows(getTrackerSheet(spreadsheet, SHIFT_SHEET, SHIFT_COLUMNS), SHIFT_COLUMNS)
    .filter(record => record.id)
    .map(toTrackerShift)
    .sort((a, b) => a.shiftDate.localeCompare(b.shiftDate) || a.savedAt.localeCompare(b.savedAt));
  const paychecks = {};
  readTrackerRows(getTrackerSheet(spreadsheet, PAYCHECK_SHEET, PAYCHECK_COLUMNS), PAYCHECK_COLUMNS)
    .forEach(record => {
      if (record.periodStart && record.actualPaycheck !== "") {
        paychecks[record.periodStart] = Number(record.actualPaycheck);
      }
    });
  return { payPeriodAnchor: PAY_PERIOD_ANCHOR, payPeriodDays: PAY_PERIOD_DAYS, shifts, paychecks };
}

function withTrackerLock(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function handleEarningsTrackerAction(action, payload, managerName) {
  const profile = getPersonalEarningsProfile(managerName);
  if (!profile || !Number.isFinite(profile.hourlyRate)) {
    throw new Error("Unsupported action.");
  }

  return withTrackerLock(() => {
    const spreadsheet = getTrackerSpreadsheet();
    if (action === "trackerList") {
      return listEarningsTracker(spreadsheet);
    }

    const shiftSheet = getTrackerSheet(spreadsheet, SHIFT_SHEET, SHIFT_COLUMNS);
    const records = readTrackerRows(shiftSheet, SHIFT_COLUMNS).filter(record => record.id);
    const now = new Date().toISOString();

    if (action === "trackerSaveShift" || action === "trackerUpdateShift") {
      const shift = buildTrackerShift(payload.shift || {}, profile.hourlyRate, profile.withholdingRate);
      const editing = action === "trackerUpdateShift"
        ? records.find(record => record.id === String(payload.id || ""))
        : null;
      if (action === "trackerUpdateShift" && !editing) {
        throw new Error("That shift no longer exists. Refresh and try again.");
      }
      const duplicate = records.find(record =>
        sameShiftSlot(record, shift.shiftDate, shift.venue) && (!editing || record.id !== editing.id)
      );
      if (duplicate && (editing || !payload.replace)) {
        return { duplicate: toTrackerShift(duplicate), ...listEarningsTracker(spreadsheet) };
      }

      const target = editing || duplicate;
      const saved = {
        ...shift,
        id: target ? target.id : Utilities.getUuid(),
        savedAt: target ? target.savedAt : now,
        updatedAt: now
      };
      writeTrackerRow(shiftSheet, target ? target.row : shiftSheet.getLastRow() + 1, shiftToRow(saved));
      return { saved: toTrackerShift(saved), replaced: Boolean(target), ...listEarningsTracker(spreadsheet) };
    }

    if (action === "trackerDeleteShift") {
      const record = records.find(item => item.id === String(payload.id || ""));
      if (record) shiftSheet.deleteRow(record.row);
      return { deleted: Boolean(record), ...listEarningsTracker(spreadsheet) };
    }

    if (action === "trackerSetPaycheck") {
      const periodStart = String(payload.periodStart || "").trim();
      if (!isPayPeriodStart(periodStart)) {
        throw new Error("Choose a valid pay period.");
      }
      const clearing = payload.actualPaycheck === null || payload.actualPaycheck === "";
      const amount = clearing ? "" : parseTrackerAmount(payload.actualPaycheck, "Actual paycheck");
      const paycheckSheet = getTrackerSheet(spreadsheet, PAYCHECK_SHEET, PAYCHECK_COLUMNS);
      const existing = readTrackerRows(paycheckSheet, PAYCHECK_COLUMNS)
        .find(record => record.periodStart === periodStart);
      const row = existing ? existing.row : paycheckSheet.getLastRow() + 1;
      writeTrackerRow(paycheckSheet, row, [periodStart, amount, now]);
      return listEarningsTracker(spreadsheet);
    }

    throw new Error("Unsupported action.");
  });
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const action = String(payload.action || "").trim();

    if (action === "authManagerPin") {
      const pin = String(payload.pin || "").replace(/\D+/g, "").slice(0, 4);
      const managerName = MANAGER_PINS[pin];
      if (!managerName) {
        throw new Error("Invalid manager PIN.");
      }

      const session = createManagerSession(managerName);
      return createJsonResponse({
        ok: true,
        managerName,
        authToken: session.authToken,
        expiresAt: session.expiresAt,
        personalEarningsProfile: getPersonalEarningsProfile(managerName),
        ...getEarningsTrackerAccess(managerName)
      });
    }

    if (action === "validateManagerSession") {
      const managerName = String(payload.managerName || "").trim();
      const authToken = String(payload.authToken || "").trim();
      const valid = validateManagerSession(managerName, authToken);
      return createJsonResponse({
        ok: true,
        valid,
        personalEarningsProfile: valid ? getPersonalEarningsProfile(managerName) : null,
        ...(valid ? getEarningsTrackerAccess(managerName) : {})
      });
    }

    if (/^tracker[A-Z]/.test(action)) {
      const managerName = requireEarningsTrackerOwner(payload);
      return createJsonResponse({ ok: true, ...handleEarningsTrackerAction(action, payload, managerName) });
    }

    throw new Error("Unsupported action.");
  } catch (err) {
    return createJsonResponse({ ok: false, error: String(err) });
  }
}
