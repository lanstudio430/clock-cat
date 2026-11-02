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

  const spreadsheet = {
    getSheetByName: (name: string) => sheets[name] ?? null,
    insertSheet: (name: string) => (sheets[name] = makeSheet(name)),
  };

  return {
    sheets,
    props,
    failLocks(value: boolean) {
      lockFails = value;
    },
    globals: {
      SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
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
      Utilities: { getUuid: () => crypto.randomUUID() },
    },
  };
}
