import { safeStorage } from "electron";
import Store from 'electron-store';
import { randomBytes, createHash } from 'crypto';

const tokenStore = new Store<TokenStore>({ name: 'secure-tokens' })
const miscStore = new Store({ name: 'misc' })

// Generates a cryptographically secure random hex string
export function generateRandomString(length: number): string {
  const bytes = randomBytes(Math.ceil(length / 2));
  return bytes.toString('hex').slice(0, length);
}

// Calculates SHA256 hash of a string
export async function sha256(plain: string): Promise<Buffer> {
  const hash = createHash('sha256');
  hash.update(plain);
  return hash.digest();
}

// Base64 URL encodes a Buffer or ArrayBuffer
export function base64UrlEncode(buffer: Buffer | ArrayBuffer): string {
  const b64 = Buffer.isBuffer(buffer)
    ? buffer.toString('base64')
    : Buffer.from(buffer).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export interface TokenStore {
  access_token: string;
  refresh_token: string;
}

export function setTokens(accessToken: string, refreshToken: string): void {
  // @ts-ignore
  tokenStore.set('access_token', safeStorage.encryptString(accessToken).toString('latin1'));
  // @ts-ignore
  tokenStore.set('refresh_token', safeStorage.encryptString(refreshToken).toString('latin1'));
}

export function getAccessToken(): string | null {
  // @ts-ignore
  const encryptedAccessToken = tokenStore.get('access_token');
  if (!encryptedAccessToken) {
    return null;
  }
  return safeStorage.decryptString(encryptedAccessToken);
}

export function getRefreshToken(): string | null {
  // @ts-ignore
  const encryptedRefreshToken = tokenStore.get('refresh_token');
  if (!encryptedRefreshToken) {
    return null;
  }
  return safeStorage.decryptString(encryptedRefreshToken);
}

export function setStore(key: string, value: string): void {
  // @ts-ignore
  miscStore.set(key, value);
}

export function getStore(key: string): string | null {
  // @ts-ignore
  const value = miscStore.get(key);
  if (!value) {
    return null;
  }
  return value;
}

export function deleteStore(key: string): void {
  // @ts-ignore
  try { miscStore.delete(key); } catch (error) { console.error(error); }
}