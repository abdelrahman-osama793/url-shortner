import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Consent } from '../../../core/consent';
import { CookieConsent } from './cookie-consent';

const stored = () => JSON.parse(localStorage.getItem('shortlist.consent') ?? 'null');

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });

    // The test DOM may not implement modal dialogs; the real browser does.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
  });

  function render() {
    const fixture = TestBed.createComponent(CookieConsent);

    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const button = (label: string) => [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!;

    return { fixture, element, button };
  }

  it('asks until a choice is made, and rejecting is one click', () => {
    const { fixture, element, button } = render();

    expect(element.querySelector('.banner')).not.toBeNull();

    button('Necessary only').click();
    fixture.detectChanges();

    expect(element.querySelector('.banner')).toBeNull();
    expect(stored()).toMatchObject({ version: 1, preferences: false, google: false });
  });

  it('accepts everything in one click', () => {
    const { button } = render();

    button('Accept all').click();

    expect(stored()).toMatchObject({ preferences: true, google: true });
  });

  it('saves a mixed choice from the settings dialog', () => {
    const { fixture, element, button } = render();

    button('Settings').click();
    fixture.detectChanges();
    expect(element.querySelector('dialog')!.open).toBe(true);

    const preferences = element.querySelector<HTMLInputElement>('#cookie-preferences')!;

    preferences.checked = true;
    preferences.dispatchEvent(new Event('change'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(stored()).toMatchObject({ preferences: true, google: false });
    expect(element.querySelector('dialog')!.open).toBe(false);
    expect(TestBed.inject(Consent).allows('google')).toBe(false);
  });

  it('does not ask again once decided, and ignores choices from an older policy version', () => {
    localStorage.setItem('shortlist.consent', JSON.stringify({ version: 1, preferences: true, google: false }));
    expect(render().element.querySelector('.banner')).toBeNull();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    localStorage.setItem('shortlist.consent', JSON.stringify({ version: 0, preferences: true, google: true }));
    expect(render().element.querySelector('.banner')).not.toBeNull();
  });
});
