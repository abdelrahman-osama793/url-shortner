import { TestBed } from '@angular/core/testing';

import { Theme } from './theme';

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

  it('applies and remembers an explicit choice', () => {
    TestBed.inject(Theme).set('dark');
    TestBed.tick();

    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('shortlist.theme')).toBe('dark');
  });

  it('restores a stored choice and ignores unknown values', () => {
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
