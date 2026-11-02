var SHIFT_SHEET = '班表';
var SHIFT_HEADERS = ['日期', '原定上班', '原定下班', '實際上班', '實際下班', '假別'];
var MONTH_SHEET = '月設定';
var MONTH_HEADERS = ['月份', '應上班時數'];
var DAY_TYPES = ['例假', '休假', '國定假日'];
var EARLIEST_TIME = 6;
var LATEST_TIME = 21.75;
var MAX_MONTH_HOURS = 744;
var MAX_MONTHS_PER_REQUEST = 6;
var API_KEY_PROPERTY = 'API_KEY';

var ACTIONS = {
  getMonths: function (request) { return getMonths(request.months); },
  saveEntry: function (request) { return saveEntry(request.entry); },
  deleteEntry: function (request) { deleteEntry(request.date); return null; },
  saveRequiredHours: function (request) { return saveRequiredHours(request.month, request.value); }
};

/** 連線測試：不需要密鑰，也不回傳任何資料。 */
function doGet() {
  return jsonOutput_({ ok: true, data: 'Clock Cat API' });
}

/** API 入口：body 為 JSON 文字 {key, action, ...參數}，回傳 {ok, data} 或 {ok: false, code, error}。 */
function doPost(e) {
  return jsonOutput_(handleRequest_(e && e.postData ? e.postData.contents : ''));
}

/** 第一次使用時，在 Apps Script 編輯器執行一次：產生密鑰並顯示在「執行記錄」。 */
function setupApiKey() {
  var properties = PropertiesService.getScriptProperties();
  var key = properties.getProperty(API_KEY_PROPERTY);
  if (!key) {
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    properties.setProperty(API_KEY_PROPERTY, key);
  }
  console.log('API_KEY: ' + key);
}

function handleRequest_(body) {
  try {
    var expected = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
    if (!expected) return failure_('not_configured', '尚未設定密鑰，請在 Apps Script 執行 setupApiKey');

    var request = parseJson_(body);
    if (!request || !isSameText_(request.key, expected)) return failure_('unauthorized', '密鑰不正確');
    if (!Object.prototype.hasOwnProperty.call(ACTIONS, request.action)) {
      return failure_('bad_request', '不支援的操作：' + request.action);
    }
    return { ok: true, data: ACTIONS[request.action](request) };
  } catch (error) {
    return failure_(error.code || 'rejected', error.message);
  }
}

function parseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    var invalid = new Error('請求格式不正確');
    invalid.code = 'bad_request';
    throw invalid;
  }
}

function failure_(code, message) {
  return { ok: false, code: code, error: message };
}

function jsonOutput_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 逐字元比對，避免從回應時間推測密鑰。 */
function isSameText_(actual, expected) {
  if (typeof actual !== 'string' || actual.length !== expected.length) return false;
  var difference = 0;
  for (var i = 0; i < expected.length; i++) {
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

/** 取得多個月份（yyyy-MM）的紀錄與應上班時數，回傳 {月份: {entries, requiredHours}}。 */
function getMonths(months) {
  if (!Array.isArray(months) || months.length < 1 || months.length > MAX_MONTHS_PER_REQUEST) {
    throw new Error('月份數量不正確');
  }
  months.forEach(assertMonth_);
  upgradeLegacySheet_();

  var shiftRows = readRows_(getSheet_(SHIFT_SHEET, SHIFT_HEADERS));
  var monthRows = readRows_(getSheet_(MONTH_SHEET, MONTH_HEADERS));
  var result = {};

  months.forEach(function (month) {
    var monthRow = monthRows.filter(function (row) { return row[0] === month; })[0];
    result[month] = {
      entries: shiftRows
        .filter(function (row) { return /^\d{4}-\d{2}-\d{2}$/.test(row[0]) && row[0].slice(0, 7) === month; })
        .map(rowToEntry_),
      requiredHours: monthRow ? parseHours_(monthRow[1]) : null
    };
  });
  return result;
}

function rowToEntry_(row) {
  return {
    date: row[0],
    plannedStart: parseHours_(row[1]),
    plannedEnd: parseHours_(row[2]),
    actualStart: parseHours_(row[3]),
    actualEnd: parseHours_(row[4]),
    dayType: row[5]
  };
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
  assertMonth_(month);
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
  try {
    lock.waitLock(10000);
  } catch (error) {
    var busy = new Error('試算表忙碌中，請稍後再試');
    busy.code = 'busy';
    throw busy;
  }
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

function assertMonth_(month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('月份不正確：' + month);
  }
}

function parseHours_(text) {
  var hours = Number(text);
  return text === '' || isNaN(hours) ? null : hours;
}

function toCell_(hours) {
  return hours === null ? '' : String(hours);
}
