// 只模擬 Code.gs 用到的 Apps Script API，資料存在記憶體裡。
export interface MockSheet {
  name: string;
  rows: string[][];
  getLastRow(): number;
  getLastColumn(): number;
  setFrozenRows(): void;
  deleteRow(row: number): void;
  getRange(row: number, column: number, rowCount?: number, columnCount?: number): MockRange;
}

interface MockRange {
  getDisplayValues(): string[][];
  getDisplayValue(): string;
  setNumberFormat(): MockRange;
  setValues(values: unknown[][]): MockRange;
}

export function createMock() {
  const sheets: Record<string, MockSheet> = {};
  const props: Record<string, string> = {};
  let lockFails = false;

  function makeSheet(name: string): MockSheet {
    const rows: string[][] = [];
    return {
      name,
      rows,
      getLastRow: () => rows.length,
      getLastColumn: () => rows.reduce((max, row) => Math.max(max, row.length), 0),
      setFrozenRows() {},
      deleteRow(row) {
        rows.splice(row - 1, 1);
      },
      getRange(row, column, rowCount = 1, columnCount = 1) {
        const range: MockRange = {
          getDisplayValues() {
            return Array.from({ length: rowCount }, (_, i) =>
              Array.from({ length: columnCount }, (_, j) => String(rows[row - 1 + i]?.[column - 1 + j] ?? '')),
            );
          },
          getDisplayValue() {
            return String(rows[row - 1]?.[column - 1] ?? '');
          },
          setNumberFormat() {
            return range;
          },
          setValues(values) {
            values.forEach((line, i) => {
              rows[row - 1 + i] = rows[row - 1 + i] || [];
              line.forEach((cell, j) => {
                rows[row - 1 + i][column - 1 + j] = String(cell);
              });
            });
            return range;
          },
        };
        return range;
      },
    };
  }

  function makeSpreadsheet(id: string, title: string, sheets: Record<string, MockSheet> = {}) {
    return {
      id,
      title,
      sheets,
      /** 在雲端硬碟的哪個資料夾；新建的試算表在根目錄 */
      folder: '我的雲端硬碟',
      getId: () => id,
      getSheetByName: (name: string) => sheets[name] ?? null,
      insertSheet: (name: string) => (sheets[name] = makeSheet(name)),
      toast() {},
    };
  }
  type MockSpreadsheet = ReturnType<typeof makeSpreadsheet>;

  // 主控試算表（Apps Script 綁定的那份）；其他使用者的試算表用 ID 開
  const MAIN_ID = 'MAIN_SPREADSHEET_ID_0000';
  const spreadsheet = makeSpreadsheet(MAIN_ID, '工時貓', sheets);
  spreadsheet.folder = '工時貓';
  const spreadsheets: Record<string, MockSpreadsheet> = { [MAIN_ID]: spreadsheet };
  let created = 0;
  /** 接下來幾次移動會失敗；Infinity 代表一直失敗 */
  let moveFails = 0;
  const sleeps: number[] = [];

  // 只模擬用到的 DriveApp：查檔案所在的資料夾、移動檔案
  const driveFile = (id: string) => {
    const file = spreadsheets[id];
    if (!file) throw new Error('No item with the given ID could be found');
    return {
      getParents: () => {
        let done = false;
        return { hasNext: () => !done, next: () => ((done = true), { name: file.folder, getName: () => file.folder }) };
      },
      moveTo(folder: { name: string }) {
        if (moveFails > 0) {
          moveFails--;
          throw new Error('Access denied: DriveApp');
        }
        file.folder = folder.name;
      },
    };
  };

  return {
    sheets,
    props,
    spreadsheets,
    sleeps,
    /** 模擬移動檔案失敗：接下來 times 次失敗，預設一直失敗 */
    failMoves(times = Infinity) {
      moveFails = times;
    },
    /** 新增一份可以用 ID 打開的試算表 */
    addSpreadsheet(id: string) {
      return (spreadsheets[id] = makeSpreadsheet(id, id));
    },
    failLocks(value: boolean) {
      lockFails = value;
    },
    globals: {
      DriveApp: { getFileById: driveFile },
      ScriptApp: { AuthMode: { FULL: 'FULL' }, requireAllScopes() {} },
      SpreadsheetApp: {
        getActiveSpreadsheet: () => spreadsheet,
        openById: (id: string) => {
          if (!spreadsheets[id]) throw new Error('Unexpected error while getting the method or property openById');
          return spreadsheets[id];
        },
        create: (title: string) => {
          const id = `CREATED_SPREADSHEET_${String(++created).padStart(4, '0')}`;
          return (spreadsheets[id] = makeSpreadsheet(id, title));
        },
      },
      LockService: {
        getScriptLock: () => ({
          waitLock() {
            if (lockFails) throw new Error('Could not obtain lock');
          },
          releaseLock() {},
        }),
      },
      PropertiesService: {
        getScriptProperties: () => ({
          getProperty: (key: string) => (key in props ? props[key] : null),
          setProperty: (key: string, value: string) => {
            props[key] = value;
          },
        }),
      },
      ContentService: {
        MimeType: { JSON: 'JSON' },
        createTextOutput: (text: string) => ({ getContent: () => text, setMimeType() { return this; } }),
      },
      Utilities: { getUuid: () => crypto.randomUUID(), sleep: (ms: number) => void sleeps.push(ms) },
    },
  };
}
