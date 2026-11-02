// 本機儲存：瀏覽器可能封鎖或清空，所有讀寫都要容錯。
// 鍵名與 v1.1.0 相同，升級後原本的快取與待同步變更都還在。
export const KEYS = {
  settings: 'clockcat:settings',
  queue: 'clockcat:queue',
  pay: 'clockcat:pay',
  monthPrefix: 'clockcat:month:',
} as const;

export const store = {
  get<T>(key: string): T | null {
    try {
      const text = localStorage.getItem(key);
      return text === null ? null : (JSON.parse(text) as T);
    } catch {
      return null;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 空間不足或被封鎖時，只是失去離線快取
    }
  },
  remove(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // 同上
    }
  },
  removeWithPrefix(prefix: string): void {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      // 同上
    }
  },
};
