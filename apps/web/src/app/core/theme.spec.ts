import { TestBed } from '@angular/core/testing';

import { Consent } from './consent';
import { Theme } from './theme';

const allowPreferences = () => localStorage.setItem('shortlist.consent', JSON.stringify({ version: 1, preferences: true, google: false }));

describe('Theme', () => {
  const root = document.documentElement;

  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('data-theme');
    TestBed.resetTestingModule();
  });

  it('follows the system appearance by default', () => {
    const theme = TestBed.inject(Theme);

    TestBed.tick();

    expect(theme.preference()).toBe('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });

  it('applies and remembers an explicit choice when preferences are allowed', () => {
    allowPreferences();
    TestBed.inject(Theme).set('dark');
    TestBed.tick();

    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('shortlist.theme')).toBe('dark');
  });

  it('applies a choice without storing it until preferences are allowed, and forgets it when withdrawn', () => {
    const theme = TestBed.inject(Theme);
    const consent = TestBed.inject(Consent);

    theme.set('dark');
    TestBed.tick();
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('shortlist.theme')).toBeNull();

    consent.acceptAll();
    TestBed.tick();
    expect(localStorage.getItem('shortlist.theme')).toBe('dark');

    consent.necessaryOnly();
    TestBed.tick();
    expect(localStorage.getItem('shortlist.theme')).toBeNull();
  });

  it('ignores a stored choice without consent', () => {
    localStorage.setItem('shortlist.theme', 'light');

    expect(TestBed.inject(Theme).preference()).toBe('system');
  });

  it('restores a stored choice and ignores unknown values', () => {
    allowPreferences();
    localStorage.setItem('shortlist.theme', 'light');
    expect(TestBed.inject(Theme).preference()).toBe('light');

    TestBed.resetTestingModule();
    localStorage.setItem('shortlist.theme', 'purple');
    expect(TestBed.inject(Theme).preference()).toBe('system');
  });

  it('keeps working when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    try {
      const theme = TestBed.inject(Theme);

      theme.set('dark');
      TestBed.tick();

      expect(root.getAttribute('data-theme')).toBe('dark');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
