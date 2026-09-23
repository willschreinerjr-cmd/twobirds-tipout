const SHEET_ID = "1z3PVRaNaVq1XeBZ-nvmObPmNWJElsu_ze-SN7QKRf7Y";
const BLOCK_COLUMNS = 4;
const VENUE_GAP = 1;
const DATE_SECTION_GAP = 1;
const VENUE_SORT_ORDER = ["ivy house", "starling", "society", "psp", "rivulet"];
const DATE_SEPARATOR_WIDTH = 22;
const DATE_SEPARATOR_COLOR = "#1f2937";
const NOTES_COLUMNS = 3;
const FINDER_COLUMNS = 2;
const WORKDAY_ROLLOVER_HOUR = 3;
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
  "1290": "Ben McGill"
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

function moneyWhole(n) {
  return "$" + Math.floor(Number(n) || 0).toLocaleString("en-US");
}

function normalizePersonName(name) {
  const text = String(name || "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text
    .split(" ")
    .map(part => {
      if (/^[A-Z]{2,3}$/.test(part)) return part;
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function parseDateValue(value) {
  if (!value) return null;

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return value;
  }

  const text = String(value).trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = Number(isoMatch[1]);
    const month = Number(isoMatch[2]);
    const day = Number(isoMatch[3]);
    const localDate = new Date(year, month - 1, day);
    return isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function toISODate(value) {
  if (!value) return "";

  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    const tzOffset = value.getTimezoneOffset() * 60000;
    return new Date(value.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  if (!text) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    const tzOffset = parsed.getTimezoneOffset() * 60000;
    return new Date(parsed.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  return "";
}

function formatDayLabel(value) {
  const parsed = parseDateValue(value);
  const date = parsed || new Date();
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE, MMM d");
}

function normalizeDayLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";

  const iso = toISODate(text);
  if (iso) return formatDayLabel(iso);

  const parsed = parseDateValue(text);
  if (parsed) return formatDayLabel(parsed);

  return text;
}

function getMonthTabName(value) {
  const date = parseDateValue(value);
  if (!date) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "MMMM");
  }

  return Utilities.formatDate(date, Session.getScriptTimeZone(), "MMMM");
}

function getBusinessDateISO(submittedAtValue, fallbackDateValue) {
  const submittedAt = parseDateValue(submittedAtValue);
  if (submittedAt) {
    const adjusted = new Date(submittedAt.getTime());
    if (adjusted.getHours() < WORKDAY_ROLLOVER_HOUR) {
      adjusted.setDate(adjusted.getDate() - 1);
    }
    return toISODate(adjusted);
  }

  return toISODate(fallbackDateValue) || toISODate(new Date());
}

function getMonthlySheet(ss, dateValue) {
  const tabName = getMonthTabName(dateValue);
  return ss.getSheetByName(tabName) || ss.insertSheet(tabName);
}

function getMonthlyNotesSheet(ss, dateValue) {
  const tabName = `${getMonthTabName(dateValue)} Notes Log`;
  const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);
  if (sheet.getMaxColumns() < NOTES_COLUMNS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), NOTES_COLUMNS - sheet.getMaxColumns());
  }
  return sheet;
}

function getReceiptFinderSheet(ss) {
  const tabName = "Receipt Finder";
  const sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

  if (sheet.getMaxColumns() < FINDER_COLUMNS) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), FINDER_COLUMNS - sheet.getMaxColumns());
  }

  sheet.setColumnWidth(1, 120);
  sheet.setColumnWidth(2, 220);

  return sheet;
}

function upsertFinderEntry(dayMap, dayOrder, dateISO, venue, linkUrl) {
  if (!dayMap[dateISO]) {
    dayMap[dateISO] = [];
    dayOrder.push(dateISO);
  }

  const venueKey = String(venue || "").trim().toLowerCase();
  const idx = dayMap[dateISO].findIndex(entry => entry.venueKey === venueKey);
  const entry = {
    dateISO,
    venue: String(venue || "").trim(),
    venueKey,
    linkUrl: String(linkUrl || "")
  };

  if (idx >= 0) {
    dayMap[dateISO][idx] = entry;
  } else {
    dayMap[dateISO].push(entry);
  }
}

function readReceiptFinderModel(finderSheet) {
  const dayMap = {};
  const dayOrder = [];
  const lastRow = finderSheet.getLastRow();
  if (lastRow === 0) return { dayMap, dayOrder };

  const readCols = Math.max(finderSheet.getLastColumn(), 3);
  const values = finderSheet.getRange(1, 1, lastRow, readCols).getValues();
  const formulas = finderSheet.getRange(1, 1, lastRow, readCols).getFormulas();
  let currentDateISO = "";

  for (let i = 0; i < values.length; i++) {
    const col1 = String(values[i][0] || "").trim();
    const col2 = String(values[i][1] || "").trim();
    const col3 = String(values[i][2] || "").trim();

    const headerMatch = col1.match(/(\d{4}-\d{2}-\d{2})/);
    if (col1 && !col2 && !col3 && headerMatch) {
      currentDateISO = headerMatch[1];
      if (!dayMap[currentDateISO]) {
        dayMap[currentDateISO] = [];
        dayOrder.push(currentDateISO);
      }
      continue;
    }

    if (col1 === "Date" && col2 === "Venue") continue;
    if (col1 === "Venue" && (col2 === "Go To Receipt" || col2 === "Open Receipt")) continue;

    const rowDate = toISODate(col1);
    const isLegacyThreeCol = !!rowDate;
    const venue = isLegacyThreeCol ? col2 : col1;
    if (!venue) continue;

    const dateISO = rowDate || currentDateISO;
    if (!dateISO) continue;

    const formula = isLegacyThreeCol ? (formulas[i][2] || "") : (formulas[i][1] || "");
    const linkMatch = formula.match(/HYPERLINK\("([^"]+)"/i);
    const linkUrl = linkMatch ? linkMatch[1] : "";

    upsertFinderEntry(dayMap, dayOrder, dateISO, venue, linkUrl);
  }

  return { dayMap, dayOrder };
}

function rewriteReceiptFinderSheet(finderSheet, dayMap, dayOrder) {
  const lastRow = finderSheet.getLastRow();
  const lastCol = finderSheet.getLastColumn();
  if (lastRow > 0 && lastCol > 0) {
    finderSheet.getRange(1, 1, lastRow, Math.max(lastCol, FINDER_COLUMNS)).breakApart();
  }

  finderSheet.clearContents();
  finderSheet.clearFormats();
  finderSheet.clearNotes();

  const rows = [];
  const sections = [];

  const sortedDays = [...dayOrder].sort((a, b) => (a < b ? 1 : -1));
  sortedDays.forEach(dateISO => {
    const entries = (dayMap[dateISO] || []).slice().sort((a, b) => a.venue.localeCompare(b.venue));
    if (!entries.length) return;

    const headerRow = rows.length + 1;
    rows.push([`${formatDayLabel(dateISO)} (${dateISO})`, ""]);

    const tableHeaderRow = rows.length + 1;
    rows.push(["Venue", "Go To Receipt"]);

    const firstEntryRow = rows.length + 1;
    entries.forEach(entry => {
      rows.push([
        entry.venue,
        entry.linkUrl ? `=HYPERLINK("${entry.linkUrl}","Open Receipt")` : ""
      ]);
    });

    rows.push(["", ""]);

    sections.push({
      headerRow,
      tableHeaderRow,
      firstEntryRow,
      entryCount: entries.length
    });
  });

  if (!rows.length) {
    finderSheet.setFrozenRows(0);
    finderSheet.setColumnWidth(1, 120);
    finderSheet.setColumnWidth(2, 220);
    return;
  }

  finderSheet.getRange(1, 1, rows.length, FINDER_COLUMNS).setValues(rows);

  sections.forEach(section => {
    const dayRange = finderSheet.getRange(section.headerRow, 1, 1, FINDER_COLUMNS);
    dayRange.breakApart();
    dayRange.merge();
    dayRange
      .setFontWeight("bold")
      .setFontSize(13)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground("#c7d2fe")
      .setFontColor("#111827");

    finderSheet.getRange(section.tableHeaderRow, 1, 1, FINDER_COLUMNS)
      .setFontWeight("bold")
      .setBackground("#e5e7eb");

    const fullTableRows = section.entryCount + 2;
    finderSheet.getRange(section.headerRow, 1, fullTableRows, FINDER_COLUMNS)
      .setBorder(true, true, true, true, true, true, "#9ca3af", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

    finderSheet.getRange(section.tableHeaderRow, 1, section.entryCount + 1, FINDER_COLUMNS)
      .setBorder(true, true, true, true, true, true, "#d1d5db", SpreadsheetApp.BorderStyle.SOLID);

    for (let i = 0; i < section.entryCount; i++) {
      const row = section.firstEntryRow + i;
      const bg = (i % 2 === 0) ? "#ffffff" : "#f8fafc";
      finderSheet.getRange(row, 1, 1, FINDER_COLUMNS).setBackground(bg);
    }
  });

  finderSheet.setFrozenRows(0);
  finderSheet.setColumnWidth(1, 120);
  finderSheet.setColumnWidth(2, 220);
}

function syncReceiptFinder(ss, targetDate, venue, monthSheetId, dayStartCol, receiptStartRow) {
  const dateISO = toISODate(targetDate);
  const venueText = String(venue || "").trim();
  const venueKey = venueText.toLowerCase();
  if (!dateISO || !venueKey) return;

  const targetA1 = `${columnToA1(dayStartCol)}${Math.max(1, Number(receiptStartRow) || 1)}`;
  const linkUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${monthSheetId}&range=${targetA1}`;

  const finderSheet = getReceiptFinderSheet(ss);
  const model = readReceiptFinderModel(finderSheet);
  upsertFinderEntry(model.dayMap, model.dayOrder, dateISO, venueText, linkUrl);
  rewriteReceiptFinderSheet(finderSheet, model.dayMap, model.dayOrder);
}

function getNotesEntryLink(ss, dateValue, venueValue) {
  const targetDate = toISODate(dateValue);
  const targetDay = normalizeDayLabel(targetDate || dateValue);
  const venueKey = String(venueValue || "").trim().toLowerCase();
  if (!targetDay || !venueKey) return null;

  const notesSheet = getMonthlyNotesSheet(ss, targetDate || dateValue);
  const lastRow = notesSheet.getLastRow();
  if (lastRow === 0) return null;

  const values = notesSheet.getRange(1, 1, lastRow, NOTES_COLUMNS).getValues();
  let currentDay = "";

  for (let i = 0; i < values.length; i++) {
    const col1 = String(values[i][0] || "").trim();
    const col2 = String(values[i][1] || "").trim();
    const col3 = String(values[i][2] || "").trim();

    if (col1 && !col2 && !col3) {
      currentDay = normalizeDayLabel(col1);
      continue;
    }

    if ((col1 === "Venue" || col1 === "Venue:") && (col2 === "Notes" || col2 === "Notes:")) continue;

    if (currentDay === targetDay && col1 && col2) {
      if (col1.toLowerCase() === venueKey) {
        const row = i + 1;
        const linkUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${notesSheet.getSheetId()}&range=A${row}`;
        return { linkUrl };
      }
    }
  }

  return null;
}

function columnToA1(col) {
  let n = Math.max(1, Number(col) || 1);
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function isRowEmpty(rowValues) {
  for (let i = 0; i < rowValues.length; i++) {
    if (String(rowValues[i] || "").trim() !== "") return false;
  }
  return true;
}

function getBlockHeight(sheet, startRow, startCol, lastRow) {
  const numRows = lastRow - startRow + 1;
  const values = sheet.getRange(startRow, startCol, numRows, BLOCK_COLUMNS).getValues();

  for (let i = 1; i < values.length; i++) {
    if (isRowEmpty(values[i])) {
      return i + 1;
    }
  }

  return values.length;
}

function findReceiptBlocks(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow === 0) return [];

  const lastCol = Math.max(sheet.getLastColumn(), BLOCK_COLUMNS);
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const blocks = [];

  for (let r = 0; r < values.length - 2; r++) {
    for (let c = 0; c <= lastCol - BLOCK_COLUMNS; c++) {
      const headVenue = String(values[r][c] || "").trim();
      const headDate = toISODate(values[r][c + 1]);
      const nextRowLabel = String(values[r + 1][c] || "").trim();
      const row2Label = String(values[r + 2][c] || "").trim();

      let headerOffset = -1;
      if (row2Label === "Role") {
        headerOffset = 2;
      } else if ((row2Label === "Notes" || row2Label === "Notes:") && r + 3 < values.length) {
        const roleAfterNotes = String(values[r + 3][c] || "").trim();
        if (roleAfterNotes === "Role") {
          headerOffset = 3;
        }
      }

      if (headerOffset === -1) continue;

      const headerRole = String(values[r + headerOffset][c] || "").trim();
      const headerName = String(values[r + headerOffset][c + 1] || "").trim();
      const headerHours = String(values[r + headerOffset][c + 2] || "").trim();
      const headerTipout = String(values[r + headerOffset][c + 3] || "").trim();

      if (
        headVenue &&
        headDate &&
        (nextRowLabel === "Total Pot" || nextRowLabel === "Total Pot:") &&
        headerRole === "Role" &&
        headerName === "Name" &&
        headerHours === "Hours" &&
        headerTipout === "Tipout"
      ) {
        const row = r + 1;
        const col = c + 1;
        blocks.push({
          row,
          col,
          date: headDate,
          venueRaw: headVenue,
          venueKey: headVenue.toLowerCase(),
          height: getBlockHeight(sheet, row, col, lastRow)
        });
      }
    }
  }

  return blocks.sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

function buildDateSections(blocks) {
  const map = {};

  blocks.forEach(block => {
    const key = block.date || "";
    if (!key) return;

    if (!map[key]) {
      map[key] = {
        date: key,
        col: block.col,
        topRow: block.row,
        bottomRow: block.row + block.height - 1,
        blocks: [block]
      };
    } else {
      map[key].col = Math.min(map[key].col, block.col);
      map[key].topRow = Math.min(map[key].topRow, block.row);
      map[key].bottomRow = Math.max(map[key].bottomRow, block.row + block.height - 1);
      map[key].blocks.push(block);
    }
  });

  return Object.keys(map)
    .map(key => map[key])
    .sort((a, b) => a.col - b.col);
}

function getVenueSortRank(venue) {
  const key = String(venue || "").trim().toLowerCase();
  const idx = VENUE_SORT_ORDER.indexOf(key);
  return idx >= 0 ? idx : 99;
}

function normalizeDateSectionVenueOrder(sheet, dateISO) {
  const targetDate = toISODate(dateISO);
  if (!targetDate) return;

  const blocks = findReceiptBlocks(sheet)
    .filter(block => block.date === targetDate)
    .sort((a, b) => a.row - b.row);
  if (blocks.length <= 1) return;

  const ordered = blocks.slice().sort((a, b) => {
    const rankDiff = getVenueSortRank(a.venueKey) - getVenueSortRank(b.venueKey);
    if (rankDiff !== 0) return rankDiff;
    return a.row - b.row;
  });

  const isAlreadyOrdered = blocks.every((block, idx) => block.row === ordered[idx].row && block.col === ordered[idx].col);
  if (isAlreadyOrdered) return;

  const sectionCol = Math.min(...blocks.map(block => block.col));
  const sectionTopRow = Math.min(...blocks.map(block => block.row));
  const sectionBottomRow = Math.max(...blocks.map(block => block.row + block.height - 1));
  const sectionHeight = sectionBottomRow - sectionTopRow + 1;

  const ss = sheet.getParent();
  let tempSheet = null;

  try {
    tempSheet = ss.insertSheet(`__tmp_reorder_${Date.now()}`);

    const copyMap = new Map();
    let tempCursor = 1;
    blocks.forEach(block => {
      const key = `${block.row}:${block.col}`;
      sheet.getRange(block.row, block.col, block.height, BLOCK_COLUMNS)
        .copyTo(tempSheet.getRange(tempCursor, 1, block.height, BLOCK_COLUMNS), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);
      copyMap.set(key, { tempRow: tempCursor, height: block.height });
      tempCursor += block.height;
    });

    sheet.getRange(sectionTopRow, sectionCol, sectionHeight, BLOCK_COLUMNS).clearContent().clearFormat();

    let cursorRow = sectionTopRow;
    ordered.forEach((block, idx) => {
      const key = `${block.row}:${block.col}`;
      const copied = copyMap.get(key);
      if (!copied) return;

      tempSheet.getRange(copied.tempRow, 1, copied.height, BLOCK_COLUMNS)
        .copyTo(sheet.getRange(cursorRow, sectionCol, copied.height, BLOCK_COLUMNS), SpreadsheetApp.CopyPasteType.PASTE_NORMAL, false);

      cursorRow += copied.height;
      if (idx < ordered.length - 1) {
        cursorRow += VENUE_GAP;
      }
    });
  } finally {
    if (tempSheet) {
      ss.deleteSheet(tempSheet);
    }
  }
}

function styleDateSectionSeparators(sheet) {
  const blocks = findReceiptBlocks(sheet);
  const sections = buildDateSections(blocks);
  if (!sections.length) return;

  const maxRows = Math.max(sheet.getMaxRows(), 1);
  const maxCols = Math.max(sheet.getMaxColumns(), 1);
  const separatorCols = [];

  for (let i = 0; i < sections.length - 1; i++) {
    const separatorCol = sections[i].col + BLOCK_COLUMNS;
    separatorCols.push(separatorCol);
  }

  separatorCols.forEach(col => {
    if (col > 1) {
      sheet.getRange(1, col - 1, maxRows, 1)
        .setBorder(null, null, null, false, null, null);
    }

    if (col < maxCols) {
      sheet.getRange(1, col + 1, maxRows, 1)
        .setBorder(null, false, null, null, null, null);
    }

    sheet.setColumnWidth(col, DATE_SEPARATOR_WIDTH);
    sheet.getRange(1, col, maxRows, 1)
      .setBackground(DATE_SEPARATOR_COLOR)
      .setFontColor(DATE_SEPARATOR_COLOR)
      .setBorder(false, false, false, false, false, false);
  });

  blocks.forEach(block => {
    reapplyReceiptBlockFormatting(sheet, block);
  });
}

function reapplyReceiptBlockFormatting(sheet, block) {
  const startRow = block.row;
  const startCol = block.col;
  const detailCount = Math.max(1, block.height - 4);

  sheet.getRange(startRow + 2, startCol, detailCount + 1, BLOCK_COLUMNS)
    .setBorder(true, true, true, true, true, true);

  sheet.getRange(startRow + 3, startCol + 2, detailCount, 1).setHorizontalAlignment("right");
  sheet.getRange(startRow + 3, startCol + 3, detailCount, 1).setHorizontalAlignment("right");
  sheet.getRange(startRow + 1, startCol + 1, 1, 1).setHorizontalAlignment("right");
}

function repairReceiptFormattingForSheetName(sheetName) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const targetSheet = ss.getSheetByName(String(sheetName || "").trim());
  if (!targetSheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const blocks = findReceiptBlocks(targetSheet);
  blocks.forEach(block => {
    reapplyReceiptBlockFormatting(targetSheet, block);
  });

  styleDateSectionSeparators(targetSheet);

  return {
    sheet: targetSheet.getName(),
    blocksFixed: blocks.length
  };
}

function repairCurrentMonthReceiptFormatting() {
  const currentMonthSheetName = getMonthTabName(new Date());
  return repairReceiptFormattingForSheetName(currentMonthSheetName);
}

function upsertDayEntry(dayMap, dayOrder, day, venue, notes) {
  if (!dayMap[day]) {
    dayMap[day] = [];
    dayOrder.push(day);
  }

  const venueKey = venue.toLowerCase();
  const idx = dayMap[day].findIndex(entry => entry.venueKey === venueKey);
  const entry = { venue, venueKey, notes };

  if (idx >= 0) {
    dayMap[day][idx] = entry;
  } else {
    dayMap[day].push(entry);
  }
}

function readNotesModel(notesSheet) {
  const dayMap = {};
  const dayOrder = [];
  const lastRow = notesSheet.getLastRow();
  if (lastRow === 0) return { dayMap, dayOrder };

  const values = notesSheet.getRange(1, 1, lastRow, NOTES_COLUMNS).getValues();
  const row1 = values[0].map(v => String(v || "").trim());
  const isLegacyFlat = row1[0] === "Day" && row1[1] === "Venue" && row1[2] === "Notes";

  if (isLegacyFlat) {
    for (let i = 1; i < values.length; i++) {
      const day = normalizeDayLabel(values[i][0]);
      const venue = String(values[i][1] || "").trim();
      const notes = String(values[i][2] || "").trim();
      if (!day || !venue) continue;
      upsertDayEntry(dayMap, dayOrder, day, venue, notes);
    }
    return { dayMap, dayOrder };
  }

  let currentDay = "";
  for (let i = 0; i < values.length; i++) {
    const col1 = String(values[i][0] || "").trim();
    const col2 = String(values[i][1] || "").trim();
    const col3 = String(values[i][2] || "").trim();

    if (col1 && !col2 && !col3) {
      currentDay = normalizeDayLabel(col1);
      if (!dayMap[currentDay]) {
        dayMap[currentDay] = [];
        dayOrder.push(currentDay);
      }
      continue;
    }

    if ((col1 === "Venue" || col1 === "Venue:") && (col2 === "Notes" || col2 === "Notes:")) continue;

    if (currentDay && col1 && col2) {
      upsertDayEntry(dayMap, dayOrder, currentDay, col1, col2);
    }
  }

  return { dayMap, dayOrder };
}

function rewriteNotesSheet(notesSheet, dayMap, dayOrder) {
  const lastRow = notesSheet.getLastRow();
  const lastCol = notesSheet.getLastColumn();
  if (lastRow > 0 && lastCol > 0) {
    notesSheet.getRange(1, 1, lastRow, Math.max(lastCol, NOTES_COLUMNS)).breakApart();
  }

  notesSheet.clearContents();
  notesSheet.clearFormats();
  notesSheet.clearNotes();

  const rows = [];
  const sections = [];

  dayOrder.forEach(day => {
    const entries = dayMap[day] || [];
    if (!entries.length) return;

    const headerRow = rows.length + 1;
    rows.push([day, "", ""]);

    const tableHeaderRow = rows.length + 1;
    rows.push(["Venue:", "Notes:", ""]);

    const firstEntryRow = rows.length + 1;
    entries.forEach(entry => {
      rows.push([entry.venue, entry.notes, ""]);
    });

    rows.push(["", "", ""]);

    sections.push({
      headerRow,
      tableHeaderRow,
      firstEntryRow,
      entryCount: entries.length
    });
  });

  if (!rows.length) {
    notesSheet.setFrozenRows(0);
    notesSheet.setColumnWidth(1, 220);
    notesSheet.setColumnWidth(2, 520);
    notesSheet.setColumnWidth(3, 40);
    return;
  }

  notesSheet.getRange(1, 1, rows.length, NOTES_COLUMNS).setValues(rows);

  sections.forEach(section => {
    const dayRange = notesSheet.getRange(section.headerRow, 1, 1, 2);
    dayRange.breakApart();
    dayRange.merge();
    dayRange
      .setFontWeight("bold")
      .setFontSize(13)
      .setHorizontalAlignment("center")
      .setVerticalAlignment("middle")
      .setBackground("#c7d2fe")
      .setFontColor("#111827");
    notesSheet.setRowHeightsForced(section.headerRow, 1, 30);

    notesSheet.getRange(section.tableHeaderRow, 1, 1, 2)
      .setFontWeight("bold")
      .setBackground("#e5e7eb");

    notesSheet.getRange(section.firstEntryRow, 2, section.entryCount, 1)
      .setWrap(true)
      .setVerticalAlignment("top");

    notesSheet.getRange(section.firstEntryRow, 1, section.entryCount, 1)
      .setFontWeight("bold")
      .setBackground("#eef6ff")
      .setVerticalAlignment("middle");

    for (let i = 0; i < section.entryCount; i++) {
      const row = section.firstEntryRow + i;
      const bg = (i % 2 === 0) ? "#ffffff" : "#f8fafc";
      notesSheet.getRange(row, 2, 1, 1).setBackground(bg);
    }

    notesSheet.getRange(section.tableHeaderRow, 1, section.entryCount + 1, 2)
      .setBorder(true, true, true, true, true, true);
  });

  notesSheet.setFrozenRows(1);
  notesSheet.setColumnWidth(1, 220);
  notesSheet.setColumnWidth(2, 520);
  notesSheet.setColumnWidth(3, 40);
}

function syncNotesLog(ss, dateValue, venueValue, notesValue) {
  const targetDate = toISODate(dateValue);
  const targetDay = normalizeDayLabel(targetDate || dateValue);
  const venue = String(venueValue || "").trim();
  const venueKey = venue.toLowerCase();
  const notes = String(notesValue || "").trim();

  if (!targetDay || !venueKey) return;

  const notesSheet = getMonthlyNotesSheet(ss, targetDate || dateValue);
  const model = readNotesModel(notesSheet);
  const dayMap = model.dayMap;
  const dayOrder = model.dayOrder;

  if (dayMap[targetDay]) {
    dayMap[targetDay] = dayMap[targetDay].filter(entry => entry.venueKey !== venueKey);
    if (!dayMap[targetDay].length) {
      delete dayMap[targetDay];
      const idx = dayOrder.indexOf(targetDay);
      if (idx >= 0) dayOrder.splice(idx, 1);
    }
  }

  if (notes) {
    upsertDayEntry(dayMap, dayOrder, targetDay, venue, notes);
  }

  rewriteNotesSheet(notesSheet, dayMap, dayOrder);
}

/* ─── Toast POS Integration ─── */

function getToastAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty("TOAST_CLIENT_ID");
  const clientSecret = props.getProperty("TOAST_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Toast API credentials not configured. Set TOAST_CLIENT_ID and TOAST_CLIENT_SECRET in Script Properties.");
  }

  const res = UrlFetchApp.fetch("https://login.toasttab.com/usermgmt/v1/oauth/token", {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      clientId: clientId,
      clientSecret: clientSecret,
      userAccessType: "TOAST_MACHINE_CLIENT"
    }),
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error("Toast authentication failed (HTTP " + res.getResponseCode() + ").");
  }

  const data = JSON.parse(res.getContentText());
  return data.token && data.token.accessToken ? data.token.accessToken : data.accessToken || "";
}

function getToastGuidForVenue(venue) {
  const props = PropertiesService.getScriptProperties();
  const key = "TOAST_GUID_" + String(venue || "").trim().toUpperCase().replace(/\s+/g, "_");
  const guid = props.getProperty(key);
  if (!guid) {
    throw new Error("No Toast GUID configured for venue \"" + venue + "\". Set " + key + " in Script Properties.");
  }
  return guid;
}

function fetchToastStaffForVenue(venue, dateISO) {
  const guid = getToastGuidForVenue(venue);
  const accessToken = getToastAccessToken();
  const businessDate = dateISO || toISODate(new Date());

  const url = "https://api.toasttab.com/labor/v1/timeEntries?businessDate=" + encodeURIComponent(businessDate);

  const res = UrlFetchApp.fetch(url, {
    method: "get",
    headers: {
      "Authorization": "Bearer " + accessToken,
      "Toast-Restaurant-External-ID": guid,
      "Content-Type": "application/json"
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error("Toast labor API failed (HTTP " + res.getResponseCode() + ").");
  }

  const entries = JSON.parse(res.getContentText());
  if (!Array.isArray(entries)) return [];

  const staffMap = {};
  entries.forEach(function(entry) {
    const empName = normalizePersonName(
      (entry.employeeFirstName || "") + " " + (entry.employeeLastName || "")
    );
    if (!empName) return;

    const inTime = entry.inDate ? new Date(entry.inDate) : null;
    const outTime = entry.outDate ? new Date(entry.outDate) : null;
    var hours = 0;
    if (inTime && outTime) {
      hours = Math.round(((outTime - inTime) / 3600000) * 4) / 4;
    } else if (inTime) {
      hours = Math.round(((new Date() - inTime) / 3600000) * 4) / 4;
    }
    hours = Math.max(0, hours);

    if (staffMap[empName]) {
      staffMap[empName] += hours;
    } else {
      staffMap[empName] = hours;
    }
  });

  var result = [];
  for (var name in staffMap) {
    if (staffMap.hasOwnProperty(name)) {
      result.push({ name: name, hours: Math.round(staffMap[name] * 4) / 4 });
    }
  }
  return result;
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
        expiresAt: session.expiresAt
      });
    }

    if (action === "validateManagerSession") {
      const managerName = String(payload.managerName || "").trim();
      const authToken = String(payload.authToken || "").trim();
      return createJsonResponse({
        ok: true,
        valid: validateManagerSession(managerName, authToken)
      });
    }

    if (action === "fetchToastStaff") {
      requireValidManagerAuth(payload);
      const venue = String(payload.venue || "").trim();
      if (!venue) throw new Error("Venue is required.");
      const dateISO = payload.date || toISODate(new Date());
      const staff = fetchToastStaffForVenue(venue, dateISO);
      return createJsonResponse({ ok: true, staff: staff });
    }

    const managerName = requireValidManagerAuth(payload);
    payload.managerName = managerName;

    const targetDate = getBusinessDateISO(payload.submittedAt, payload.date);
    const targetVenue = String(payload.venue || "").trim().toLowerCase();
    const notes = String(payload.notes || "").trim();

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const sheet = getMonthlySheet(ss, targetDate || payload.date);

    const maxCols = sheet.getMaxColumns();
    if (maxCols < BLOCK_COLUMNS) {
      sheet.insertColumnsAfter(maxCols, BLOCK_COLUMNS - maxCols);
    }

    const roleSortRank = {
      "Shift Manager": 0,
      "Bartender": 1
    };

    const entries = (Array.isArray(payload.entries) ? payload.entries : [])
      .slice()
      .sort((a, b) => {
        const aRole = String(a && a.role ? a.role : "").trim();
        const bRole = String(b && b.role ? b.role : "").trim();
        const aRank = Object.prototype.hasOwnProperty.call(roleSortRank, aRole) ? roleSortRank[aRole] : 99;
        const bRank = Object.prototype.hasOwnProperty.call(roleSortRank, bRole) ? roleSortRank[bRole] : 99;
        if (aRank !== bRank) return aRank - bRank;
        return 0;
      });
    const hasNotes = notes.length > 0;
    const detailRows = entries.length
      ? entries.map(entry => [
          entry.role || "",
          normalizePersonName(entry.name),
          entry.hours == null ? "" : Number(entry.hours),
          moneyWhole(entry.tipout)
        ])
      : [["", "", "", ""]];

    const rows = [
      [payload.venue || "", targetDate || payload.date || "", "", ""],
      ["Total Pot:", moneyWhole(payload.totalPot), "Notes", hasNotes ? "✓" : "✗"],
      ["Role", "Name", "Hours", "Tipout"],
      ...detailRows,
      ["", "", "", ""]
    ];

    const newBlockHeight = rows.length;

    let blocks = findReceiptBlocks(sheet);
    if (blocks.some(block => block.row === 1)) {
      sheet.insertRowBefore(1);
      blocks = findReceiptBlocks(sheet);
    }
    const dateSections = buildDateSections(blocks);

    let replacedRows = 0;
    let startRow = 2;
    let startCol = 1;

    const existingBlock = blocks.find(
      block => block.date === targetDate && block.venueKey === targetVenue
    );

    const dateSection = dateSections.find(section => section.date === targetDate);

    if (existingBlock) {
      startRow = existingBlock.row;
      startCol = existingBlock.col;
      replacedRows = existingBlock.height;
    } else if (dateSection) {
      startRow = dateSection.bottomRow + VENUE_GAP + 1;
      startCol = dateSection.col;
    } else {
      if (dateSections.length) {
        const rightmost = dateSections[dateSections.length - 1];
        startCol = rightmost.col + BLOCK_COLUMNS + DATE_SECTION_GAP;
      } else {
        startCol = 1;
      }
      startRow = 2;
    }

    const neededCols = startCol + BLOCK_COLUMNS - 1;
    if (sheet.getMaxColumns() < neededCols) {
      sheet.insertColumnsAfter(sheet.getMaxColumns(), neededCols - sheet.getMaxColumns());
    }

    if (existingBlock) {
      if (newBlockHeight > existingBlock.height) {
        sheet.insertRowsAfter(startRow + existingBlock.height - 1, newBlockHeight - existingBlock.height);
      }
      sheet.getRange(startRow, startCol, existingBlock.height, BLOCK_COLUMNS).clearContent().clearFormat();
    }

    const dayLabelRange = sheet.getRange(1, startCol, 1, BLOCK_COLUMNS);
    dayLabelRange.breakApart();
    dayLabelRange.merge();
    dayLabelRange.setValue(formatDayLabel(targetDate || payload.date));
    dayLabelRange
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setBackground("#c7d2fe")
      .setFontColor("#111827");

    sheet.getRange(startRow, startCol, rows.length, BLOCK_COLUMNS).setValues(rows);

    sheet.getRange(startRow, startCol, 1, 2)
      .setFontWeight("bold")
      .setBackground("#dbeafe");
    sheet.getRange(startRow, startCol + 2, 1, 2)
      .setBackground(null)
      .setFontWeight("normal");

    sheet.getRange(startRow + 1, startCol, 1, 2)
      .setFontWeight("bold")
      .setFontColor("#ffffff")
      .setBackground("#16a34a");
    sheet.getRange(startRow + 1, startCol + 2, 1, 1)
      .setFontWeight("bold")
      .setBackground("#f3f4f6")
      .setFontColor("#111827")
      .setNote("Legend: ✓ = notes submitted, ✗ = no notes submitted");
    const notesFlagCell = sheet.getRange(startRow + 1, startCol + 3, 1, 1);
    notesFlagCell
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setFontColor(hasNotes ? "#166534" : "#991b1b")
      .setBackground(hasNotes ? "#dcfce7" : "#fee2e2");

    sheet.getRange(startRow + 2, startCol, 1, BLOCK_COLUMNS)
      .setFontWeight("bold")
      .setBackground("#eef2ff");

    const detailCount = detailRows.length;
    sheet.getRange(startRow + 2, startCol, detailCount + 1, BLOCK_COLUMNS)
      .setBorder(true, true, true, true, true, true);

    sheet.getRange(startRow + 3, startCol + 2, detailCount, 1).setHorizontalAlignment("right");
    sheet.getRange(startRow + 3, startCol + 3, detailCount, 1).setHorizontalAlignment("right");

    sheet.getRange(startRow + 1, startCol + 1, 1, 1).setHorizontalAlignment("right");

    sheet.setColumnWidth(startCol, 190);
    sheet.setColumnWidth(startCol + 1, 120);
    sheet.setColumnWidth(startCol + 2, 110);
    sheet.setColumnWidth(startCol + 3, 90);

    sheet.setFrozenRows(1);

    syncNotesLog(ss, targetDate || payload.date, payload.venue || "", notes);

    if (hasNotes) {
      const notesLink = getNotesEntryLink(ss, targetDate || payload.date, payload.venue || "");
      if (notesLink && notesLink.linkUrl) {
        notesFlagCell.setFormula(`=HYPERLINK("${notesLink.linkUrl}","✓")`);
      } else {
        notesFlagCell.setValue("✓");
      }
    } else {
      notesFlagCell.setValue("✗");
    }

    if (existingBlock && newBlockHeight < existingBlock.height) {
      const rowsToDelete = existingBlock.height - newBlockHeight;
      sheet.deleteRows(startRow + newBlockHeight, rowsToDelete);
    }

    normalizeDateSectionVenueOrder(sheet, targetDate || payload.date);

    sheet.autoResizeColumns(startCol, BLOCK_COLUMNS);
    styleDateSectionSeparators(sheet);

    syncReceiptFinder(
      ss,
      targetDate || payload.date,
      payload.venue || "",
      sheet.getSheetId(),
      startCol,
      startRow
    );

    return createJsonResponse({ ok: true, rowsWritten: rows.length, replacedRows });
  } catch (err) {
    return createJsonResponse({ ok: false, error: String(err) });
  }
}
