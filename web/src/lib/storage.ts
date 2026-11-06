// 本機儲存：瀏覽器可能封鎖或清空，所有讀寫都要容錯。
// 第一位使用者（main）沿用 v1.1.0 的鍵名，升級後原本的快取與待同步變更都還在；
// 之後新增的使用者各自有一組加了前綴的鍵。
export const KEYS = {
  /** 舊版的單一連線設定，只在第一次升級時讀取 */
  settings: 'clockcat:settings',
  profiles: 'clockcat:profiles',
  queue: 'clockcat:queue',
  pay: 'clockcat:pay',
  monthPrefix: 'clockcat:month:',
} as const;

export const MAIN_PROFILE = 'main';

export interface ProfileKeys {
  queue: string;
  pay: string;
  monthPrefix: string;
}

/** 某位使用者的快取、待同步變更與薪資設定存在哪些鍵 */
export function keysFor(profileId: string): ProfileKeys {
  if (profileId === MAIN_PROFILE) return { queue: KEYS.queue, pay: KEYS.pay, monthPrefix: KEYS.monthPrefix };
  const prefix = `clockcat:u:${profileId}:`;
  return { queue: `${prefix}queue`, pay: `${prefix}pay`, monthPrefix: `${prefix}month:` };
}

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
