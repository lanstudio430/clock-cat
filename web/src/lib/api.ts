import type { Settings } from './types';

/**
 * offline：稍後重試；config：需要使用者修正設定；rejected：試算表拒絕這筆變更。
 * short 是印章上的簡短說明，message 是完整原因。
 */
export type ErrorKind = 'offline' | 'config' | 'rejected';

export class ApiError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly short: string,
    /** 伺服器回傳的錯誤代碼，例如 bad_request、unauthorized；連不上時沒有 */
    readonly code?: string,
  ) {
    super(message);
  }
}

const SERVER_ERRORS: Record<string, [ErrorKind, string]> = {
  rejected: ['rejected', '沒存到'],
  busy: ['offline', '試算表忙碌中'],
  unauthorized: ['config', '密鑰不正確'],
  not_configured: ['config', '後端未設定密鑰'],
  bad_request: ['config', '請求格式有誤'],
};

const ACCESS_HINT = '請確認網址正確，且部署的存取權限是「任何人」';

export async function callApi<T>(settings: Settings, action: string, params: Record<string, unknown>, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(settings.url, {
      method: 'POST',
      // text/plain 是「簡單請求」，不會觸發 CORS 預檢，Apps Script 才收得到
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ key: settings.key, action, ...params }),
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch {
    if (navigator.onLine === false) throw new ApiError('offline', '目前沒有網路', '離線');
    throw new ApiError('offline', `無法連線到 Apps Script，${ACCESS_HINT}`, '連不上');
  } finally {
    clearTimeout(timer);
  }

  let payload: { ok: boolean; data?: T; code?: string; error?: string };
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('config', `無法讀取伺服器回應，${ACCESS_HINT}`, '網址或權限有誤');
  }
  if (!payload.ok) {
    const [kind, short] = SERVER_ERRORS[payload.code ?? ''] ?? ['config', '連線設定有誤'];
    throw new ApiError(kind, payload.error || short, short, payload.code);
  }
  return payload.data as T;
}
