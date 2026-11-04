import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

// Optional storage the visitor may allow (Cookie Policy). Session and security cookies are
// strictly necessary and need no consent; they are not listed here.
//   preferences  the light/dark choice, kept in localStorage
//   google       Google's sign-in script, which sets Google's own cookies
export type ConsentCategory = 'preferences' | 'google';

export type ConsentChoice = Record<ConsentCategory, boolean>;

// Bump when categories change, so everyone is asked again.
const VERSION = 1;
const STORAGE_KEY = 'shortlist.consent';

// The visitor's cookie choice. The record of the choice is itself necessary (otherwise the
// banner would return on every page), so it is stored before anything optional is. Storage can
// be unavailable; then the choice lasts for this page view and nothing optional is kept.
@Injectable({ providedIn: 'root' })
export class Consent {
  private readonly document = inject(DOCUMENT);

  private readonly choice = signal<ConsentChoice | null>(this.load());

  readonly decided = computed(() => this.choice() !== null);
  readonly settingsOpen = signal(false);

  allows(category: ConsentCategory): boolean {
    return this.choice()?.[category] ?? false;
  }

  current(): ConsentChoice {
    return this.choice() ?? { preferences: false, google: false };
  }

  save(choice: ConsentChoice): void {
    this.choice.set({ ...choice });
    this.settingsOpen.set(false);

    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...choice, decidedAt: new Date().toISOString() }));
    } catch {
      // Storage unavailable: the choice lasts for this page view only.
    }
  }

  acceptAll(): void {
    this.save({ preferences: true, google: true });
  }

  necessaryOnly(): void {
    this.save({ preferences: false, google: false });
  }

  // Allows one category without touching the others (e.g. "Allow Google sign-in").
  grant(category: ConsentCategory): void {
    this.save({ ...this.current(), [category]: true });
  }

  private load(): ConsentChoice | null {
    try {
      const stored = JSON.parse(this.document.defaultView?.localStorage.getItem(STORAGE_KEY) ?? 'null');

      if (stored?.version !== VERSION) return null;

      return { preferences: stored.preferences === true, google: stored.google === true };
    } catch {
      return null;
    }
  }
}
