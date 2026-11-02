var SHIFT_SHEET = '班表';
var SHIFT_HEADERS = ['日期', '原定上班', '原定下班', '實際上班', '實際下班', '假別'];
var MONTH_SHEET = '月設定';
var MONTH_HEADERS = ['月份', '應上班時數'];
var DAY_TYPES = ['例假', '休假', '國定假日'];
var EARLIEST_TIME = 6;
var LATEST_TIME = 21.75;
var MAX_MONTH_HOURS = 744;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('上班日記')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 取得行事曆資料：日期區間（yyyy-MM-dd，含頭尾）內的紀錄，以及該月份（yyyy-MM）的應上班時數。 */
function getCalendarData(from, to, month) {
  upgradeLegacySheet_();

  var sheet = getSheet_(SHIFT_SHEET, SHIFT_HEADERS);
  var entries = readRows_(sheet)
    .filter(function (row) { return row[0] >= from && row[0] <= to; })
    .map(function (row) {
      return {
        date: row[0],
        plannedStart: parseHours_(row[1]),
        plannedEnd: parseHours_(row[2]),
        actualStart: parseHours_(row[3]),
        actualEnd: parseHours_(row[4]),
        dayType: row[5]
      };
    });

  var monthRow = readRows_(getSheet_(MONTH_SHEET, MONTH_HEADERS))
    .filter(function (row) { return row[0] === month; })[0];

  return { entries: entries, requiredHours: monthRow ? parseHours_(monthRow[1]) : null };
}

/** 新增或更新某一天的紀錄，回傳整理後的內容。 */
function saveEntry(input) {
  var entry = normalizeEntry_(input);
  return withLock_(function () {
    upsertRow_(getSheet_(SHIFT_SHEET, SHIFT_HEADERS), [
      entry.date,
      toCell_(entry.plannedStart),
      toCell_(entry.plannedEnd),
      toCell_(entry.actualStart),
      toCell_(entry.actualEnd),
      entry.dayType
    ]);
    return entry;
  });
}

function deleteEntry(date) {
  assertDate_(date);
  withLock_(function () {
    deleteRowByKey_(getSheet_(SHIFT_SHEET, SHIFT_HEADERS), date);
  });
}

/** 儲存某月份的應上班時數，留空代表清除；回傳整理後的時數。 */
function saveRequiredHours(month, value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('月份不正確：' + month);
  }
  var isBlank = value === '' || value === null || value === undefined;
  var hours = isBlank ? null : Number(value);
  if (!isBlank && !(hours >= 0 && hours <= MAX_MONTH_HOURS)) {
    throw new Error('應上班時數需介於 0 到 ' + MAX_MONTH_HOURS + ' 之間');
  }

  withLock_(function () {
    var sheet = getSheet_(MONTH_SHEET, MONTH_HEADERS);
    if (isBlank) {
      deleteRowByKey_(sheet, month);
    } else {
      upsertRow_(sheet, [month, toCell_(hours)]);
    }
  });
  return hours;
}

function getSheet_(name, headers) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(name);
  if (sheet) return sheet;

  sheet = spreadsheet.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readRows_(sheet) {
  var rowCount = sheet.getLastRow() - 1;
  if (rowCount < 1) return [];
  return sheet.getRange(2, 1, rowCount, sheet.getLastColumn()).getDisplayValues();
}

function findRow_(sheet, key) {
  var rowCount = sheet.getLastRow() - 1;
  if (rowCount < 1) return null;

  var keys = sheet.getRange(2, 1, rowCount, 1).getDisplayValues();
  for (var i = 0; i < keys.length; i++) {
    if (keys[i][0] === key) return i + 2;
  }
  return null;
}

function upsertRow_(sheet, values) {
  var row = findRow_(sheet, values[0]) || sheet.getLastRow() + 1;
  // 先設為純文字，避免 Sheets 把日期與月份自動轉成其他格式
  sheet.getRange(row, 1, 1, values.length)
    .setNumberFormat('@')
    .setValues([values]);
}

function deleteRowByKey_(sheet, key) {
  var row = findRow_(sheet, key);
  if (row) sheet.deleteRow(row);
}

function withLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

/** 把舊版「日期、上班、下班、假別」的班表升級成新欄位，舊時間視為實際上下班時間。 */
function upgradeLegacySheet_() {
  withLock_(function () {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHIFT_SHEET);
    if (!sheet || sheet.getRange(1, 2).getDisplayValue() !== '上班') return;

    var rows = readRows_(sheet).map(function (row) {
      return [row[0], '', '', legacyTimeToCell_(row[1]), legacyTimeToCell_(row[2]), row[3]];
    });
    sheet.getRange(1, 1, rows.length + 1, SHIFT_HEADERS.length)
      .setNumberFormat('@')
      .setValues([SHIFT_HEADERS].concat(rows));
  });
}

function legacyTimeToCell_(text) {
  var match = String(text).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '';
  return toCell_(Math.round((Number(match[1]) + Number(match[2]) / 60) * 100) / 100);
}

function normalizeEntry_(input) {
  assertDate_(input.date);

  var entry = {
    date: input.date,
    plannedStart: normalizeTime_(input.plannedStart),
    plannedEnd: normalizeTime_(input.plannedEnd),
    actualStart: normalizeTime_(input.actualStart),
    actualEnd: normalizeTime_(input.actualEnd),
    dayType: input.dayType || ''
  };

  if (entry.dayType && DAY_TYPES.indexOf(entry.dayType) === -1) {
    throw new Error('假別不正確：' + entry.dayType);
  }
  assertTimeRange_('原定', entry.plannedStart, entry.plannedEnd);
  assertTimeRange_('實際', entry.actualStart, entry.actualEnd);
  if (entry.plannedStart === null && entry.actualStart === null && !entry.dayType) {
    throw new Error('請選擇上下班時間或假別');
  }
  return entry;
}

/** 時間以小數小時表示（例如 09:30 為 9.5），只接受 6 到 21.75 之間每 0.25 一格的值；空值回傳 null。 */
function normalizeTime_(value) {
  if (value === '' || value === null || value === undefined) return null;

  var hours = Number(value);
  if (!(hours >= EARLIEST_TIME && hours <= LATEST_TIME) || (hours * 4) % 1 !== 0) {
    throw new Error('時間不正確：' + value);
  }
  return hours;
}

function assertTimeRange_(label, start, end) {
  if ((start === null) !== (end === null)) {
    throw new Error(label + '上班與下班時間需要同時選擇');
  }
  if (start !== null && end <= start) {
    throw new Error(label + '下班時間需要晚於上班時間');
  }
}

function assertDate_(date) {
  var match = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  var parsed = match && new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
  if (!parsed || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error('日期不正確：' + date);
  }
}

function parseHours_(text) {
  var hours = Number(text);
  return text === '' || isNaN(hours) ? null : hours;
}

function toCell_(hours) {
  return hours === null ? '' : String(hours);
}
