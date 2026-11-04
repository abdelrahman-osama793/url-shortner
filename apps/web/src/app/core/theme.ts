import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';

import { Consent } from './consent';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'shortlist.theme';
const PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

// Light, dark or follow the system. Remembering the choice is optional storage: it is kept in
// localStorage only with "preferences" consent, and removed when that consent is withdrawn.
// Storage can be unavailable (private windows, blocked site data), so every access is guarded
// and the default is simply "system".
@Injectable({ providedIn: 'root' })
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly consent = inject(Consent);

  readonly preference = signal<ThemePreference>(this.load());

  constructor() {
    effect(() => {
      const preference = this.preference();
      const root = this.document.documentElement;

      if (preference === 'system') root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', preference);

      if (this.consent.allows('preferences')) this.save(preference);
      else this.forget();
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
  }

  private load(): ThemePreference {
    if (!this.consent.allows('preferences')) return 'system';

    try {
      const stored = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);

      return PREFERENCES.includes(stored as ThemePreference) ? (stored as ThemePreference) : 'system';
    } catch {
      return 'system';
    }
  }

  private forget(): void {
    try {
      this.document.defaultView?.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing stored, or storage unavailable.
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
