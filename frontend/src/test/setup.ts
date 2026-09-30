import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// La aplicación carga sus módulos de ruta de forma diferida. En la regresión
// completa, la transformación inicial de esos chunks puede superar el segundo
// que Testing Library usa por defecto aunque la UI responda correctamente.
configure({ asyncUtilTimeout: 10_000 });

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(key: string) { return this.data.get(key) ?? null; }
  key(index: number) { return Array.from(this.data.keys())[index] ?? null; }
  removeItem(key: string) { this.data.delete(key); }
  setItem(key: string, value: string) { this.data.set(key, String(value)); }
}

Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: new MemoryStorage() });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});
