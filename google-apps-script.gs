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

  const props = PropertiesService.getScriptProperties();
  pruneExpiredManagerSessions(props);
  const token = createAuthToken();
  const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
  const payload = JSON.stringify({ managerName: cleanName, expiresAt });
  props.setProperty(authSessionPropertyKey(token), payload);
  return { authToken: token, expiresAt };
}

function pruneExpiredManagerSessions(props) {
  const now = Date.now();
  const all = props.getProperties();
  Object.keys(all).forEach(key => {
    if (key.indexOf(AUTH_SESSION_KEY_PREFIX) !== 0) return;
    let expiresAt = 0;
    try {
      expiresAt = Number(JSON.parse(all[key]).expiresAt);
    } catch (err) {
      expiresAt = 0;
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= now) props.deleteProperty(key);
  });
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
const WILLS_EARNINGS_SPREADSHEET_PROPERTY = "WILLS_EARNINGS_SPREADSHEET_ID";
const WILLS_EARNINGS_URL_PROPERTY = "WILLS_EARNINGS_URL";
const VENUES = ["Ivy House", "Starling", "Rivulet", "PSP", "Society"];
const STAFF_ROLES = ["Shift Manager", "Bartender"];
const MAX_EVENT_POT = 1000000;
const MAX_EVENT_STAFF = 60;

// BEGIN SHARED EARNINGS STORAGE (keep identical in twobirds-tipout/google-apps-script.gs and wills-earnings/src/Code.gs)
const EARNINGS_SHIFT_SHEET = "Shifts";
const EARNINGS_SCHEDULE_SHEET = "PaySchedule";
const EARNINGS_PAYCHECK_SHEET = "Paychecks";
const EARNINGS_OWNER_SHEET = "Owner";
const EARNINGS_SHIFT_COLUMNS = [
  "id", "idempotencyKey", "shiftDate", "venue", "eventType", "role", "hours",
  "hourlyWageCents", "wageCents", "cashTipsCents", "creditTipsCents", "guaranteeCents",
  "grossCents", "taxCents", "netCents", "cashReceivedCents", "depositCents",
  "withholdingRate", "payPeriodStart", "payPeriodEnd", "source", "createdAt", "updatedAt"
];
const EARNINGS_SCHEDULE_COLUMNS = ["startDate", "periodDays", "createdAt"];
const EARNINGS_PAYCHECK_COLUMNS = [
  "periodStart", "periodEnd", "status", "actualGrossCents", "actualTaxesCents",
  "actualDepositCents", "adjustmentsCents", "notes", "updatedAt"
];
const EARNINGS_OWNER_COLUMNS = ["ownerId", "createdAt"];
const EARNINGS_DEFAULT_SCHEDULE = { startDate: "2026-10-12", periodDays: 14 };
const EARNINGS_INTEGER_FIELDS = [
  "hourlyWageCents", "wageCents", "cashTipsCents", "creditTipsCents", "guaranteeCents", "grossCents",
  "taxCents", "netCents", "cashReceivedCents", "depositCents"
];

function earningsDayNumber(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ""));
  if (!match) return null;
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().slice(0, 10) === match[0] ? Math.round(time / 86400000) : null;
}

function earningsDayToIso(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

function earningsWriteRow(sheet, row, values) {
  // Plain-text cells keep dates, cents, and IDs exactly as written.
  sheet.getRange(row, 1, 1, values.length)
    .setNumberFormat("@")
    .setValues([values.map(value => value === null || value === undefined ? "" : String(value))]);
}

function earningsSheet(spreadsheet, name, columns) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  if (sheet.getLastRow() === 0) {
    earningsWriteRow(sheet, 1, columns);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function earningsReadRows(sheet, columns) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, columns.length).getValues().map((values, index) => {
    const record = { row: index + 2 };
    columns.forEach((column, columnIndex) => { record[column] = String(values[columnIndex]); });
    return record;
  });
}

function earningsSchedules(spreadsheet) {
  const sheet = earningsSheet(spreadsheet, EARNINGS_SCHEDULE_SHEET, EARNINGS_SCHEDULE_COLUMNS);
  let schedules = earningsReadRows(sheet, EARNINGS_SCHEDULE_COLUMNS)
    .map(record => ({ startDate: record.startDate, periodDays: Number(record.periodDays) }))
    .filter(schedule => earningsDayNumber(schedule.startDate) !== null &&
      Number.isInteger(schedule.periodDays) && schedule.periodDays > 0);
  if (!schedules.length) {
    earningsWriteRow(sheet, sheet.getLastRow() + 1, [
      EARNINGS_DEFAULT_SCHEDULE.startDate, EARNINGS_DEFAULT_SCHEDULE.periodDays, new Date().toISOString()
    ]);
    schedules = [{ ...EARNINGS_DEFAULT_SCHEDULE }];
  }
  return schedules.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function earningsPayPeriod(schedules, isoDate) {
  const day = earningsDayNumber(isoDate);
  if (day === null) throw new Error("Enter a valid date.");
  let index = 0;
  schedules.forEach((schedule, scheduleIndex) => {
    if (earningsDayNumber(schedule.startDate) <= day) index = scheduleIndex;
  });
  const schedule = schedules[index];
  const scheduleStart = earningsDayNumber(schedule.startDate);
  const start = scheduleStart + Math.floor((day - scheduleStart) / schedule.periodDays) * schedule.periodDays;
  let end = start + schedule.periodDays - 1;
  const next = schedules[index + 1];
  if (next) end = Math.min(end, earningsDayNumber(next.startDate) - 1);
  return { start: earningsDayToIso(start), end: earningsDayToIso(end) };
}

function earningsPaychecks(spreadsheet) {
  const sheet = earningsSheet(spreadsheet, EARNINGS_PAYCHECK_SHEET, EARNINGS_PAYCHECK_COLUMNS);
  return earningsReadRows(sheet, EARNINGS_PAYCHECK_COLUMNS).filter(record => record.periodStart);
}

function earningsIsVerifiedPeriod(spreadsheet, periodStart) {
  return earningsPaychecks(spreadsheet).some(record =>
    record.periodStart === periodStart && record.status === "verified");
}

function earningsShiftFromRecord(record) {
  const shift = {};
  EARNINGS_SHIFT_COLUMNS.forEach(column => { shift[column] = record[column]; });
  EARNINGS_INTEGER_FIELDS.forEach(field => { shift[field] = Number(record[field]) || 0; });
  shift.hours = Number(record.hours) || 0;
  shift.withholdingRate = Number(record.withholdingRate) || 0;
  shift.row = record.row;
  return shift;
}

function earningsShiftRow(shift) {
  return EARNINGS_SHIFT_COLUMNS.map(column => shift[column]);
}
// END SHARED EARNINGS STORAGE

// BEGIN SHARED TIP CALCULATIONS (copied verbatim from index.html; tests keep them identical)
function calculateTipPool(pot, people, mode = "cash"){
  const payoutPeople = people.filter(person =>
    ["Shift Manager", "Bartender"].includes(person.role) &&
    Number.isFinite(person.hours) && person.hours > 0
  );
  const payoutHours = payoutPeople.reduce((sum, person) => sum + person.hours, 0);
  const baseRate = payoutHours > 0 ? pot / payoutHours : 0;
  const entries = payoutHours > 0 ? payoutPeople.map(person => {
    const rate = mode === "cash" ? Math.round(baseRate * 100) / 100 : baseRate;
    return { role: person.role, name: person.name, hours: person.hours, rate,
      tipout: mode === "cash" ? Math.ceil(Number((person.hours * rate).toFixed(10))) : 0 };
  }) : [];
  if (mode === "cents" && entries.length) {
    const cents = Math.round(pot * 100);
    const shares = entries.map((entry, index) => {
      const exact = entry.hours * entry.rate * 100;
      return { index, cents: Math.floor(exact), fraction: exact - Math.floor(exact) };
    });
    const remaining = cents - shares.reduce((sum, share) => sum + share.cents, 0);
    // Largest fractional shares receive leftover cents; original row order breaks ties.
    const ranked = [...shares].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let i = 0; i < remaining; i++) ranked[i % ranked.length].cents++;
    shares.forEach(share => { entries[share.index].tipout = share.cents / 100; });
  }
  return {
    entries,
    totalEarned: Math.round(entries.reduce((sum, entry) => sum + entry.tipout, 0) * 100) / 100
  };
}

function parseGuestCount(value){
  const text = String(value).trim();
  if (!text) return { count: null, error: "" };
  const count = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(count) || count > Math.floor(Number.MAX_SAFE_INTEGER / 400)) {
    return { count: null, error: "Enter a nonnegative whole number of guests within the supported range." };
  }
  return { count, error: "" };
}

function calculatePersonalEarnings(result, profile){
  const normalize = name => String(name || "").trim().toLowerCase();
  const indexes = result.cash.entries.map((entry, index) =>
    normalize(entry.name) === normalize(profile.owner) ? index : -1
  ).filter(index => index >= 0);
  if (!indexes.length) return null;
  const hours = indexes.reduce((sum, index) => sum + result.cash.entries[index].hours, 0);
  const roleHours = {};
  const wageCents = [];
  for (const index of indexes) {
    const entry = result.cash.entries[index];
    const hourlyRate = profile.roleRates ? profile.roleRates[entry.role] : profile.hourlyRate;
    if (!Number.isFinite(hourlyRate)) {
      return { error: `No hourly rate is set for your ${entry.role} shift.` };
    }
    roleHours[entry.role] = (roleHours[entry.role] || 0) + entry.hours;
    wageCents.push(Math.round(entry.hours * hourlyRate * 100));
  }
  const wages = wageCents.reduce((sum, cents) => sum + cents, 0) / 100;
  const tips = Math.round(indexes.reduce((sum, index) =>
    sum + result.cash.entries[index].tipout + result.credit.entries[index].tipout, 0) * 100) / 100;
  const paycheckShare = Math.round(indexes.reduce((sum, index) => sum + result.paycheck.entries[index].tipout, 0) * 100) / 100;
  const baseGross = Math.round((wages + tips) * 100) / 100;
  const baseTax = Math.round(baseGross * profile.withholdingRate * 100) / 100;
  const withoutMinimum = { gross: baseGross, tax: baseTax, net: Math.round((baseGross - baseTax) * 100) / 100 };
  const gross = Math.round((wages + tips + paycheckShare) * 100) / 100;
  const tax = Math.round(gross * profile.withholdingRate * 100) / 100;
  const net = Math.round((gross - tax) * 100) / 100;
  withoutMinimum.hourlyGross = Math.round(baseGross / hours * 100) / 100;
  withoutMinimum.hourlyNet = Math.round(withoutMinimum.net / hours * 100) / 100;
  return { hours, wages, tips, roleHours, paycheckShare, withoutMinimum, gross, tax, net,
    hourlyGross: Math.round(gross / hours * 100) / 100,
    hourlyNet: Math.round(net / hours * 100) / 100 };
}

function calculateEventTips(cashPot, creditPot, people, guestCount){
  const cash = calculateTipPool(cashPot, people);
  const credit = calculateTipPool(creditPot, people, "cents");
  const totalEarned = Math.round((cash.totalEarned + credit.totalEarned) * 100) / 100;
  const guaranteedMinimum = guestCount === null ? null : guestCount * 4;
  const paycheckDifference = guaranteedMinimum === null ? 0 : Math.max(0, Math.round((guaranteedMinimum - totalEarned) * 100) / 100);
  const paycheck = calculateTipPool(paycheckDifference, people, "cents");
  return { cash, credit, totalEarned, guaranteedMinimum, paycheckDifference, paycheck,
    cashRoundingDifference: cash.totalEarned - cashPot,
    creditUnallocated: Math.round((creditPot - credit.totalEarned) * 100) / 100 };
}
// END SHARED TIP CALCULATIONS

function isEarningsTrackerOwner(managerName) {
  return String(managerName || "").trim().toLowerCase() === EARNINGS_TRACKER_OWNER.toLowerCase();
}

function getEarningsTrackerAccess(managerName) {
  if (!isEarningsTrackerOwner(managerName)) return {};
  const url = String(PropertiesService.getScriptProperties().getProperty(WILLS_EARNINGS_URL_PROPERTY) || "");
  return { earningsTracker: true, ...(/^https:\/\/script\.google\.com\//.test(url) ? { earningsSiteUrl: url } : {}) };
}

function requireEarningsTrackerOwner(payload) {
  const managerName = requireValidManagerAuth(payload);
  // Other accounts get the same response as an unsupported action, revealing nothing.
  if (!isEarningsTrackerOwner(managerName)) {
    throw new Error("Unsupported action.");
  }
  return managerName;
}

function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function parseEventPot(value, label, allowCents) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_EVENT_POT ||
      (allowCents ? Math.abs(number * 100 - Math.round(number * 100)) > 1e-6 : !Number.isInteger(number))) {
    throw new Error(`${label} is not a valid amount.`);
  }
  return allowCents ? Math.round(number * 100) / 100 : number;
}

function parseEventStaff(staff) {
  if (!Array.isArray(staff) || !staff.length || staff.length > MAX_EVENT_STAFF) {
    throw new Error("Enter the event's staff time cards before saving.");
  }
  return staff.map(row => {
    const role = String(row && row.role || "");
    const hours = Number(row && row.hours);
    if (!STAFF_ROLES.includes(role) || !Number.isFinite(hours) || hours < 0 || hours > 24) {
      throw new Error("A staff time card has an invalid role or hours.");
    }
    return { role, name: String(row.name || role).trim().replace(/\s+/g, " ").slice(0, 60), hours };
  });
}

function getWillsEarningsSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty(WILLS_EARNINGS_SPREADSHEET_PROPERTY);
  if (!id) throw new Error("Will's Earnings is not connected yet.");
  return SpreadsheetApp.openById(id);
}

// Recalculates the owner's earnings from the event inputs with the private server-side profile,
// so totals sent by a browser are never trusted.
function saveEarningsShift(payload, managerName) {
  const profile = getPersonalEarningsProfile(managerName);
  if (!profile || !Number.isFinite(profile.hourlyRate)) throw new Error("Unsupported action.");
  const idempotencyKey = String(payload.idempotencyKey || "");
  if (!/^[A-Za-z0-9-]{16,80}$/.test(idempotencyKey)) throw new Error("Invalid save request. Try again.");
  const event = payload.event || {};
  const shiftDate = String(event.shiftDate || "");
  if (earningsDayNumber(shiftDate) === null) throw new Error("Choose the date you worked.");
  const venue = String(event.venue || "");
  if (!VENUES.includes(venue)) throw new Error("Select a venue before saving your shift.");
  const isWedding = event.isWedding === true;
  let guestCount = null;
  if (isWedding && event.guestCount !== null && event.guestCount !== undefined && event.guestCount !== "") {
    guestCount = Number(event.guestCount);
    if (!Number.isSafeInteger(guestCount) || guestCount < 0 || guestCount > 100000) throw new Error("The guest count is not valid.");
  }
  const result = calculateEventTips(
    parseEventPot(event.cashPot, "Cash tip pot", false),
    parseEventPot(event.creditPot, "Credit tips", true),
    parseEventStaff(event.staff),
    guestCount
  );
  const earnings = calculatePersonalEarnings(result, profile);
  if (!earnings) throw new Error(`Add ${profile.owner} with your hours before saving.`);
  if (earnings.error) throw new Error(earnings.error);
  const own = result.cash.entries.map((entry, index) => ({ ...entry, index }))
    .filter(entry => entry.name.trim().toLowerCase() === profile.owner.toLowerCase());
  const cashTipsCents = own.reduce((sum, entry) => sum + toCents(entry.tipout), 0);
  const creditTipsCents = own.reduce((sum, entry) => sum + toCents(result.credit.entries[entry.index].tipout), 0);
  const grossCents = toCents(earnings.gross);
  const taxCents = toCents(earnings.tax);
  const netCents = grossCents - taxCents;
  const now = new Date().toISOString();

  const spreadsheet = getWillsEarningsSpreadsheet();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = earningsSheet(spreadsheet, EARNINGS_SHIFT_SHEET, EARNINGS_SHIFT_COLUMNS);
    const existing = earningsReadRows(sheet, EARNINGS_SHIFT_COLUMNS)
      .find(record => record.idempotencyKey === idempotencyKey);
    const summary = shift => ({
      id: shift.id, shiftDate: shift.shiftDate, grossCents: Number(shift.grossCents),
      netCents: Number(shift.netCents), depositCents: Number(shift.depositCents)
    });
    if (existing) return { duplicate: true, shift: summary(existing) };
    const period = earningsPayPeriod(earningsSchedules(spreadsheet), shiftDate);
    if (earningsIsVerifiedPeriod(spreadsheet, period.start)) {
      throw new Error("That pay period is marked Verified in Will's Earnings. Change its status there before adding shifts.");
    }
    const shift = {
      id: Utilities.getUuid(), idempotencyKey, shiftDate, venue,
      eventType: isWedding ? "wedding" : "non-wedding",
      role: [...new Set(own.map(entry => entry.role))].join(" + "),
      hours: earnings.hours,
      hourlyWageCents: toCents(profile.hourlyRate),
      wageCents: toCents(earnings.wages),
      cashTipsCents, creditTipsCents,
      guaranteeCents: isWedding ? toCents(earnings.paycheckShare) : 0,
      grossCents, taxCents, netCents,
      cashReceivedCents: cashTipsCents,
      depositCents: netCents - cashTipsCents,
      withholdingRate: profile.withholdingRate,
      payPeriodStart: period.start, payPeriodEnd: period.end,
      source: "TwoBirds Tipout", createdAt: now, updatedAt: now
    };
    earningsWriteRow(sheet, sheet.getLastRow() + 1, earningsShiftRow(shift));
    return { saved: true, shift: summary(shift) };
  } finally {
    lock.releaseLock();
  }
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

    if (action === "saveEarningsShift") {
      const managerName = requireEarningsTrackerOwner(payload);
      return createJsonResponse({ ok: true, ...saveEarningsShift(payload, managerName) });
    }

    throw new Error("Unsupported action.");
  } catch (err) {
    return createJsonResponse({ ok: false, error: String(err) });
  }
}
