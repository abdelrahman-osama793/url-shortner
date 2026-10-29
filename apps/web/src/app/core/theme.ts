import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'shortlist.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

// Light, dark or follow the system. The choice is a per-browser convenience kept in
// localStorage; storage can be unavailable (private windows, blocked site data), so every
// access is guarded and the default is simply "system".
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);

  readonly preference = signal<ThemePreference>(this.load());

  constructor() {
    effect(() => {
      const preference = this.preference();
      const root = this.document.documentElement;

      if (preference === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', preference);

      this.save(preference);
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  private load(): ThemePreference {
    try {
      const stored = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);

      return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
    } catch {
      return 'system';
    }
  }

  private save(preference: ThemePreference): void {
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Storage unavailable: the choice lasts for this page view only.
    }
  }
}
