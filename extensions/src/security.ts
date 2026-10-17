export function httpsOrigin(url: string | undefined): string {
  if (!url || url.length > 8192) throw new Error('Open an HTTPS website first.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Only HTTPS websites can use browser integration.');
  return parsed.origin;
}
export function sameDocument(expected: {tabId:number; origin:string; document:string}, actual: {tabId:number; origin:string; document:string}): boolean {
  return expected.tabId === actual.tabId && expected.origin === actual.origin && expected.document === actual.document;
}
export function validCapture(value: unknown): value is {username:string; password:string; document:string} {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.username === 'string' && item.username.length <= 4096 &&
    typeof item.password === 'string' && item.password.length > 0 && item.password.length <= 16384 &&
    typeof item.document === 'string' && item.document.length === 36;
}
