import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { MeResponse, User } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

import { sessionExpiryInterceptor } from '../../core/auth/session-expiry.interceptor';
import { Session } from '../../core/auth/session';

import { AccountPage } from './account';

const USER: User = { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' };

function summaryOf(overrides: Partial<MeResponse> = {}): MeResponse {
  return { user: USER, signInMethods: { password: true, google: false }, recentAuthUntil: null, ...overrides };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

let backend: HttpTestingController;

function fakeGoogle() {
  const google = { initialize: vi.fn(), renderButton: vi.fn() };

  (window as { google?: unknown }).google = { accounts: { id: google } };

  return google;
}

afterEach(() => {
  delete (window as { google?: unknown }).google;
});

async function render(summary = summaryOf()) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionExpiryInterceptor])), provideHttpClientTesting()],
  });
  TestBed.inject(Session).start({ user: summary.user, csrfToken: 'csrf' });
  backend = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(AccountPage);
  const element: HTMLElement = fixture.nativeElement;

  backend.expectOne('/api/v1/auth/me').flush(summary);
  await settle();
  fixture.detectChanges();

  const refresh = async () => {
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  return {
    fixture,
    element,
    refresh,
    text: () => element.textContent?.replace(/\s+/g, ' ') ?? '',
    button: (label: string) => [...element.querySelectorAll('button')].find((button) => button.textContent?.trim().startsWith(label)),
  };
}

describe('AccountPage', () => {
  it('shows the email, its verification and the sign-in methods of a password account', async () => {
    const page = await render();

    expect(page.text()).toContain('ada@example.com');
    expect(page.text()).toContain('Verified');
    expect(page.button('Email me a reset link')).toBeTruthy();
    expect(page.button('Connect Google')).toBeTruthy();
  });

  it('offers a Google-only account neither password enrollment nor unlinking', async () => {
    const page = await render(summaryOf({ signInMethods: { password: false, google: true } }));

    expect(page.text()).toContain("Adding a password isn't available yet");
    expect(page.text()).toContain('Connected');
    expect(page.button('Email me a reset link')).toBeUndefined();
    expect(page.button('Connect Google')).toBeUndefined();
    expect(page.text()).not.toMatch(/unlink|disconnect|remove google/i);
  });

  it('emails a reset link to the account address', async () => {
    const page = await render();

    page.button('Email me a reset link')!.click();
    await settle();

    const request = backend.expectOne('/api/v1/auth/password/forgot');

    expect(request.request.body).toEqual({ email: 'ada@example.com' });
    request.flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await page.refresh();

    expect(page.text()).toContain('Check your inbox for the reset link');
  });

  it('connects Google only after the password is confirmed, then with a link attempt', async () => {
    const google = fakeGoogle();
    const page = await render();

    page.button('Connect Google')!.click();
    await page.refresh();

    expect(page.text()).toContain("First, confirm it's you");
    expect(document.activeElement?.id).toBe('confirm-password');

    const input = page.element.querySelector<HTMLInputElement>('#confirm-password')!;

    input.value = 'wrong';
    input.dispatchEvent(new Event('input'));
    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    backend.expectOne('/api/v1/auth/reauthenticate').flush({ error: { code: 'INVALID_CREDENTIALS', message: 'The password is incorrect.' } }, { status: 401, statusText: 'x' });
    await page.refresh();

    expect(page.text()).toContain('The password is incorrect.');
    expect(TestBed.inject(Session).user()).toEqual(USER);

    input.value = 'right password';
    input.dispatchEvent(new Event('input'));
    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    backend.expectOne('/api/v1/auth/reauthenticate').flush(null, { status: 204, statusText: 'No Content' });
    await page.refresh();

    const start = backend.expectOne('/api/v1/auth/google/start');

    expect(start.request.body).toEqual({ purpose: 'link' });
    start.flush({ attemptId: 'a1', nonce: 'n1', clientId: 'c' });
    await page.refresh();

    expect(page.text()).not.toContain('or continue with email');

    const callback = google.initialize.mock.calls[0][0].callback as (response: { credential: string }) => void;

    callback({ credential: 'google-token' });
    await settle();

    const link = backend.expectOne('/api/v1/auth/google/link');

    expect(link.request.body).toEqual({ attemptId: 'a1', credential: 'google-token' });
    link.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    backend.expectOne('/api/v1/auth/me').flush(summaryOf({ signInMethods: { password: true, google: true } }));
    await page.refresh();

    expect(page.text()).toContain('Google connected');
    expect(page.button('Connect Google')).toBeUndefined();
  });

  it('skips the password step while the session is recently authenticated, and returns to it if that ran out', async () => {
    const google = fakeGoogle();
    const page = await render(summaryOf({ recentAuthUntil: new Date(Date.now() + 5 * 60_000).toISOString() }));

    page.button('Connect Google')!.click();
    await page.refresh();
    backend.expectOne('/api/v1/auth/google/start').flush({ attemptId: 'a1', nonce: 'n1', clientId: 'c' });
    await page.refresh();

    expect(page.text()).toContain('Choose the Google account to connect');

    const callback = google.initialize.mock.calls[0][0].callback as (response: { credential: string }) => void;

    callback({ credential: 'google-token' });
    await settle();
    backend.expectOne('/api/v1/auth/google/link').flush({ error: { code: 'REAUTHENTICATION_REQUIRED', message: 'x' } }, { status: 403, statusText: 'x' });
    await page.refresh();

    expect(page.text()).toContain('Please confirm your password again first.');
    expect(page.text()).toContain("First, confirm it's you");
  });

  it('explains a Google account that belongs to someone else', async () => {
    const google = fakeGoogle();
    const page = await render(summaryOf({ recentAuthUntil: new Date(Date.now() + 5 * 60_000).toISOString() }));

    page.button('Connect Google')!.click();
    await page.refresh();
    backend.expectOne('/api/v1/auth/google/start').flush({ attemptId: 'a1', nonce: 'n1', clientId: 'c' });
    await page.refresh();
    (google.initialize.mock.calls[0][0].callback as (response: { credential: string }) => void)({ credential: 't' });
    await settle();
    backend.expectOne('/api/v1/auth/google/link').flush({ error: { code: 'GOOGLE_ACCOUNT_IN_USE', message: 'x' } }, { status: 409, statusText: 'x' });
    await settle();
    backend.expectOne('/api/v1/auth/google/start').flush({ attemptId: 'a2', nonce: 'n2', clientId: 'c' });
    await page.refresh();

    expect(page.text()).toContain('already connected to a different Shortlist account');
  });
});

describe('suspension while signed in', () => {
  it('signs the person out and explains it on Log in', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionExpiryInterceptor])), provideHttpClientTesting()],
    });
    TestBed.inject(Session).start({ user: USER, csrfToken: 'csrf' });

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const outcome = firstValueFrom(TestBed.inject(HttpClient).get('/api/v1/links')).catch(() => null);

    TestBed.inject(HttpTestingController).expectOne('/api/v1/links')
      .flush({ error: { code: 'ACCOUNT_SUSPENDED', message: 'x' } }, { status: 403, statusText: 'x' });
    await outcome;

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { suspended: 1 } });
  });
});
