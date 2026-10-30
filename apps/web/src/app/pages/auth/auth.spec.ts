import { BrowserPlatformLocation, PlatformLocation } from '@angular/common';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withComponentInputBinding } from '@angular/router';
import type { User } from '@shortlist/contracts';

import { requireUser, safeNext } from '../../core/auth/guards';
import { Session } from '../../core/auth/session';

import { GoogleButton } from './google-button';
import { Login } from './login';
import { ResetPassword } from './reset-password';
import { Signup } from './signup';
import { VerifyEmail } from './verify-email';

const USER: User = { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' };

const settle = () => new Promise((resolve) => setTimeout(resolve));

let backend: HttpTestingController;
let navigate: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<boolean>>>;

function render<T>(component: Type<T>, inputs: Record<string, unknown> = {}) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([], withComponentInputBinding()),
      provideHttpClient(),
      provideHttpClientTesting(),
      // The real address bar, so tests can see one-time tokens being removed from it.
      { provide: PlatformLocation, useClass: BrowserPlatformLocation },
    ],
  });

  backend = TestBed.inject(HttpTestingController);
  navigate = vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true);
  vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockImplementation(navigate);
  vi.spyOn(TestBed.inject(Router), 'navigate').mockImplementation(navigate);

  const fixture = TestBed.createComponent(component);

  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  fixture.detectChanges();

  const element: HTMLElement = fixture.nativeElement;

  return {
    fixture,
    element,
    type(selector: string, value: string) {
      const input = element.querySelector<HTMLInputElement>(selector)!;

      input.value = value;
      input.dispatchEvent(new Event('input'));
    },
    async submit() {
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
    },
    async refresh() {
      await settle();
      fixture.detectChanges();
    },
    text: () => element.textContent ?? '',
  };
}

// The Google button asks for an attempt as soon as it renders; most tests do not use it.
function ignoreGoogle(): void {
  for (const request of backend.match('/api/v1/auth/google/start')) request.flush(null, { status: 404, statusText: 'Not Found' });
}

function answerError(url: string, status: number, code: string, fields: object[] = []): void {
  backend.expectOne(url).flush({ error: { code, message: 'Server message.', requestId: 'r', fields } }, { status, statusText: 'x' });
}

afterEach(() => {
  history.replaceState(null, '', '/');
  delete (window as { google?: unknown }).google;
});

describe('safeNext', () => {
  it('follows workspace paths only', () => {
    expect(safeNext('/app/analytics')).toBe('/app/analytics');
    expect(safeNext('/app')).toBe('/app');
    expect(safeNext('https://evil.example/app')).toBe('/app/links');
    expect(safeNext('//evil.example')).toBe('/app/links');
    expect(safeNext('/apple')).toBe('/app/links');
    expect(safeNext(undefined)).toBe('/app/links');
  });
});

describe('requireUser', () => {
  it('sends signed-out visitors to Log in with the page they wanted', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });

    const result = TestBed.runInInjectionContext(() => requireUser({} as never, { url: '/app/analytics' } as never)) as Promise<unknown>;

    await settle();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/me').flush({ error: { code: 'AUTHENTICATION_REQUIRED' } }, { status: 401, statusText: 'x' });

    expect(String(await result)).toBe('/login?next=%2Fapp%2Fanalytics');
  });

  it('lets signed-in users through', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });

    const result = TestBed.runInInjectionContext(() => requireUser({} as never, { url: '/app/links' } as never)) as Promise<unknown>;

    await settle();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/me').flush({ user: USER });

    expect(await result).toBe(true);
  });
});

describe('Login', () => {
  it('signs in, keeps the new CSRF token and goes to the requested workspace page', async () => {
    const page = render(Login, { next: '/app/analytics' });

    ignoreGoogle();
    page.type('#email', ' ada@example.com ');
    page.type('#password', 'correct horse battery');
    await page.submit();

    const request = backend.expectOne('/api/v1/auth/login');

    expect(request.request.body).toEqual({ email: 'ada@example.com', password: 'correct horse battery' });
    request.flush({ user: USER, csrfToken: 'new-token' });
    await settle();

    expect(TestBed.inject(Session).user()).toEqual(USER);
    expect(navigate).toHaveBeenCalledWith('/app/analytics');
  });

  it('ignores a ?next= outside the workspace', async () => {
    const page = render(Login, { next: 'https://evil.example' });

    ignoreGoogle();
    page.type('#email', 'ada@example.com');
    page.type('#password', 'pw');
    await page.submit();
    backend.expectOne('/api/v1/auth/login').flush({ user: USER, csrfToken: 't' });
    await settle();

    expect(navigate).toHaveBeenCalledWith('/app/links');
  });

  it('shows the generic message for wrong credentials and clears the password', async () => {
    const page = render(Login);

    ignoreGoogle();
    page.type('#email', 'ada@example.com');
    page.type('#password', 'wrong');
    await page.submit();
    answerError('/api/v1/auth/login', 401, 'INVALID_CREDENTIALS');
    await page.refresh();

    expect(page.text()).toContain('Server message.');
    expect(page.element.querySelector<HTMLInputElement>('#password')!.value).toBe('');
    expect(document.activeElement?.id).toBe('password');
  });

  it('asks for both fields before sending anything', async () => {
    const page = render(Login);

    ignoreGoogle();
    await page.submit();
    await page.refresh();

    expect(page.text()).toContain('Enter your email address and password.');
    backend.expectNone('/api/v1/auth/login');
  });
});

describe('Signup', () => {
  it('checks the password length before sending', async () => {
    const page = render(Signup);

    ignoreGoogle();
    page.type('#email', 'ada@example.com');
    page.type('#password', 'short');
    await page.submit();
    await page.refresh();

    expect(page.text()).toContain('Use at least 12 characters.');
    backend.expectNone('/api/v1/auth/register');
  });

  it('registers and moves to the check-your-inbox screen without putting the email in the URL', async () => {
    const page = render(Signup);

    ignoreGoogle();
    page.type('#email', 'ada@example.com');
    page.type('#password', 'a long enough password');
    await page.submit();
    backend.expectOne('/api/v1/auth/register').flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await settle();

    expect(navigate).toHaveBeenCalledWith(['/signup/check-email'], { state: { email: 'ada@example.com' } });
  });
});

describe('VerifyEmail', () => {
  it('removes the token from the address and uses it only when confirmed', async () => {
    history.replaceState(null, '', '/verify-email#token=abc123');

    const page = render(VerifyEmail);

    expect(location.hash).toBe('');
    backend.expectNone('/api/v1/auth/email/verify');

    page.element.querySelector<HTMLButtonElement>('button')!.click();
    await settle();

    const request = backend.expectOne('/api/v1/auth/email/verify');

    expect(request.request.body).toEqual({ token: 'abc123' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    backend.expectOne('/api/v1/auth/me').flush({ error: {} }, { status: 401, statusText: 'x' });
    await page.refresh();

    expect(page.text()).toContain('Email verified');
    expect(page.text()).toContain('Continue to log in');
  });

  it('explains an expired link and offers a new one', async () => {
    history.replaceState(null, '', '/verify-email#token=old');

    const page = render(VerifyEmail);

    page.element.querySelector<HTMLButtonElement>('button')!.click();
    await settle();
    answerError('/api/v1/auth/email/verify', 400, 'TOKEN_EXPIRED');
    await page.refresh();

    expect(page.text()).toContain('This link has expired');
    expect(page.text()).toContain('Send a new link');
  });

  it('treats a link without a token as invalid', () => {
    history.replaceState(null, '', '/verify-email');

    expect(render(VerifyEmail).text()).toContain("This link isn't valid");
  });
});

describe('ResetPassword', () => {
  it('requires matching passwords', async () => {
    history.replaceState(null, '', '/reset-password#token=t1');

    const page = render(ResetPassword);

    page.type('#new-password', 'a long enough password');
    page.type('#confirm-password', 'something else entirely');
    await page.submit();
    await page.refresh();

    expect(page.text()).toContain("The passwords don't match.");
    backend.expectNone('/api/v1/auth/password/reset');
  });

  it('resets the password and leads back to log in', async () => {
    history.replaceState(null, '', '/reset-password#token=t1');

    const page = render(ResetPassword);

    expect(location.hash).toBe('');
    page.type('#new-password', 'a long enough password');
    page.type('#confirm-password', 'a long enough password');
    await page.submit();

    const request = backend.expectOne('/api/v1/auth/password/reset');

    expect(request.request.body).toEqual({ token: 't1', newPassword: 'a long enough password' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await settle();
    backend.expectOne('/api/v1/auth/me').flush({ error: {} }, { status: 401, statusText: 'x' });
    await page.refresh();

    expect(page.text()).toContain('Password reset complete');
  });

  it('explains a used link', async () => {
    history.replaceState(null, '', '/reset-password#token=t1');

    const page = render(ResetPassword);

    page.type('#new-password', 'a long enough password');
    page.type('#confirm-password', 'a long enough password');
    await page.submit();
    answerError('/api/v1/auth/password/reset', 400, 'TOKEN_USED');
    await page.refresh();

    expect(page.text()).toContain('This link was already used');
  });
});

describe('GoogleButton', () => {
  function fakeGoogle() {
    const google = { initialize: vi.fn(), renderButton: vi.fn() };

    (window as { google?: unknown }).google = { accounts: { id: google } };

    return google;
  }

  async function ready(google: ReturnType<typeof fakeGoogle>) {
    const page = render(GoogleButton);
    const signedIn = vi.fn();

    page.fixture.componentInstance.signedIn.subscribe(signedIn);
    await settle();
    backend.expectOne('/api/v1/auth/google/start').flush({ attemptId: 'a1', nonce: 'n1', clientId: 'client.apps.googleusercontent.com' });
    await page.refresh();

    const callback = google.initialize.mock.calls[0][0].callback as (response: { credential: string }) => void;

    return { page, signedIn, callback };
  }

  it("initialises Google with the server's client ID and nonce and renders Google's button", async () => {
    const google = fakeGoogle();

    await ready(google);

    expect(google.initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'client.apps.googleusercontent.com', nonce: 'n1' }));
    expect(google.renderButton).toHaveBeenCalledTimes(1);
  });

  it('exchanges the credential for a session', async () => {
    const google = fakeGoogle();
    const { signedIn, callback } = await ready(google);

    callback({ credential: 'id-token' });
    await settle();

    const request = backend.expectOne('/api/v1/auth/google');

    expect(request.request.body).toEqual({ attemptId: 'a1', credential: 'id-token' });
    request.flush({ user: USER, csrfToken: 't' });
    await settle();

    expect(signedIn).toHaveBeenCalledWith(USER);
    expect(TestBed.inject(Session).user()).toEqual(USER);
  });

  it('explains an existing password account and prepares a new attempt', async () => {
    const google = fakeGoogle();
    const { page, callback } = await ready(google);

    callback({ credential: 'id-token' });
    await settle();
    answerError('/api/v1/auth/google', 409, 'ACCOUNT_LINK_REQUIRED');
    await settle();
    backend.expectOne('/api/v1/auth/google/start').flush({ attemptId: 'a2', nonce: 'n2', clientId: 'c' });
    await page.refresh();

    expect(page.text()).toContain('then connect Google from your account page');
    expect(google.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ nonce: 'n2' }));
  });

  it('hides itself and the divider when Google sign-in is not configured', async () => {
    fakeGoogle();

    const page = render(GoogleButton);

    await settle();
    ignoreGoogle();
    await page.refresh();

    expect(page.text()).not.toContain('or continue with email');
  });
});
