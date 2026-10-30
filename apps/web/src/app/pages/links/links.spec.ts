import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Link, User } from '@shortlist/contracts';

import { sessionExpiryInterceptor } from '../../core/auth/session-expiry.interceptor';
import { Session } from '../../core/auth/session';

import { fromDateInput, toDateInput, todayInput } from './expiry';
import { LinksPage } from './links';

const USER: User = { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' };

function linkOf(overrides: Partial<Link> = {}): Link {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    code: 'launch',
    shortUrl: 'http://localhost:4200/r/launch',
    destinationUrl: 'https://example.com/launch',
    expiresAt: null,
    enabled: true,
    effectiveStatus: 'active',
    version: 1,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

let backend: HttpTestingController;

async function render(user: User = USER, page = { items: [linkOf()], nextCursor: null as string | null }) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([sessionExpiryInterceptor])), provideHttpClientTesting()],
  });
  TestBed.inject(Session).start({ user, csrfToken: 'csrf' });
  backend = TestBed.inject(HttpTestingController);

  const fixture = TestBed.createComponent(LinksPage);
  const element: HTMLElement = fixture.nativeElement;

  backend.expectOne('/api/v1/links').flush(page);
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
    text: () => element.textContent ?? '',
    button: (label: string) => [...element.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)!,
    type(selector: string, value: string) {
      const input = element.querySelector<HTMLInputElement>(selector)!;

      input.value = value;
      input.dispatchEvent(new Event('input'));
    },
    async submit() {
      element.querySelector('form')!.dispatchEvent(new Event('submit'));
      await settle();
    },
  };
}

function answerError(request: ReturnType<HttpTestingController['expectOne']>, status: number, code: string, fields: object[] = []): void {
  request.flush({ error: { code, message: 'Server message.', requestId: 'r', fields } }, { status, statusText: 'x' });
}

describe('expiry dates', () => {
  it('round-trips a chosen day as the end of that local day', () => {
    const iso = fromDateInput('2026-11-30')!;

    expect(toDateInput(iso)).toBe('2026-11-30');
    expect(new Date(iso).getHours()).toBe(23);
    expect(fromDateInput('')).toBeNull();
    expect(toDateInput(null)).toBe('');
    expect(todayInput(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('LinksPage', () => {
  it('lists real links with their status, expiry and actions', async () => {
    const page = await render(USER, {
      items: [
        linkOf(),
        linkOf({ id: '00000000-0000-4000-8000-0000000000a2', code: 'gone', effectiveStatus: 'blocked' }),
        linkOf({ id: '00000000-0000-4000-8000-0000000000a3', code: 'old', effectiveStatus: 'expired', expiresAt: '2026-10-01T10:00:00.000Z' }),
      ],
      nextCursor: null,
    });

    const rows = page.element.querySelectorAll('li');

    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Disable');
    expect(rows[1].textContent).toContain('Blocked by Shortlist moderation');
    expect(rows[1].textContent).not.toContain('Enable');
    expect(rows[2].textContent).toContain('Expired 1 Oct 2026');
    expect(rows[2].textContent).not.toMatch(/Enable|Disable/);
  });

  it('shows an empty state for a new account', async () => {
    const page = await render(USER, { items: [], nextCursor: null });

    expect(page.text()).toContain('No links yet');
  });

  it('loads the next page with the cursor and skips links already shown', async () => {
    const page = await render(USER, { items: [linkOf()], nextCursor: 'c1' });

    page.button('Show more links').click();
    await settle();

    const request = backend.expectOne((req) => req.url === '/api/v1/links' && req.params.get('cursor') === 'c1');

    request.flush({ items: [linkOf(), linkOf({ id: '00000000-0000-4000-8000-0000000000a9', code: 'second' })], nextCursor: null });
    await page.refresh();

    expect(page.element.querySelectorAll('li')).toHaveLength(2);
    expect(page.text()).not.toContain('Show more links');
  });

  it('cannot create links until the email address is verified', async () => {
    const page = await render({ ...USER, emailVerified: false });

    expect(page.element.querySelector<HTMLButtonElement>('#create-link')!.disabled).toBe(true);
  });

  it('creates a link with an idempotency key, reusing it when the same request is retried', async () => {
    const page = await render();

    page.button('Create link').click();
    await page.refresh();
    page.type('#destination', 'https://example.com/new');
    page.type('#alias', 'my-alias');
    await page.submit();

    const first = backend.expectOne((req) => req.method === 'POST');
    const key = first.request.headers.get('Idempotency-Key');

    expect(first.request.body).toEqual({ destinationUrl: 'https://example.com/new', customAlias: 'my-alias', expiresAt: null });
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    answerError(first, 503, 'SERVICE_UNAVAILABLE');
    await page.refresh();

    expect(page.element.querySelector<HTMLInputElement>('#destination')!.value).toBe('https://example.com/new');

    await page.submit();

    const retry = backend.expectOne((req) => req.method === 'POST');

    expect(retry.request.headers.get('Idempotency-Key')).toBe(key);
    retry.flush(linkOf({ id: '00000000-0000-4000-8000-0000000000b1', code: 'my-alias', shortUrl: 'http://localhost:4200/r/my-alias' }));
    await page.refresh();

    expect(page.element.querySelectorAll('li')[0].textContent).toContain('/r/my-alias');
    expect(page.element.querySelector('app-link-editor')).toBeNull();
  });

  it('marks a taken alias on the alias field and keeps the input', async () => {
    const page = await render();

    page.button('Create link').click();
    await page.refresh();
    page.type('#destination', 'https://example.com/new');
    page.type('#alias', 'taken');
    await page.submit();
    answerError(backend.expectOne((req) => req.method === 'POST'), 409, 'ALIAS_UNAVAILABLE');
    await page.refresh();

    expect(page.text()).toContain('That alias is taken or reserved');
    expect(page.element.querySelector<HTMLInputElement>('#alias')!.value).toBe('taken');
  });

  it('edits with If-Match and sends only what changed', async () => {
    const page = await render();

    page.button('Edit').click();
    await page.refresh();

    expect(page.element.querySelector<HTMLInputElement>('#destination')!.value).toBe('https://example.com/launch');

    page.type('#destination', 'https://example.com/updated');
    await page.submit();

    const request = backend.expectOne((req) => req.method === 'PATCH');

    expect(request.request.headers.get('If-Match')).toBe('"v1"');
    expect(request.request.body).toEqual({ destinationUrl: 'https://example.com/updated' });
    request.flush(linkOf({ destinationUrl: 'https://example.com/updated', version: 2 }));
    await page.refresh();

    expect(page.text()).toContain('https://example.com/updated');
  });

  it('never silently overwrites a newer edit: shows the latest version and saves over it only when asked again', async () => {
    const page = await render();

    page.button('Edit').click();
    await page.refresh();
    page.type('#destination', 'https://example.com/mine');
    await page.submit();
    answerError(backend.expectOne((req) => req.method === 'PATCH'), 412, 'PRECONDITION_FAILED');
    await settle();
    backend.expectOne((req) => req.method === 'GET' && req.url.endsWith('0a1')).flush(linkOf({ destinationUrl: 'https://example.com/theirs', version: 2 }));
    await page.refresh();

    expect(page.text()).toContain('This link was changed somewhere else');
    expect(page.text()).toContain('https://example.com/theirs');
    expect(page.element.querySelector<HTMLInputElement>('#destination')!.value).toBe('https://example.com/mine');

    await page.submit();

    const retry = backend.expectOne((req) => req.method === 'PATCH');

    expect(retry.request.headers.get('If-Match')).toBe('"v2"');
    retry.flush(linkOf({ destinationUrl: 'https://example.com/mine', version: 3 }));
  });

  it('disables and enables with the current version', async () => {
    const page = await render();

    page.button('Disable').click();
    await settle();

    const request = backend.expectOne((req) => req.method === 'PATCH');

    expect(request.request.body).toEqual({ enabled: false });
    expect(request.request.headers.get('If-Match')).toBe('"v1"');
    request.flush(linkOf({ enabled: false, effectiveStatus: 'disabled', version: 2 }));
    await page.refresh();

    expect(page.button('Enable')).toBeTruthy();
  });

  it('sends people to Log in with an explanation when their session has ended', async () => {
    const page = await render(USER, { items: [], nextCursor: null });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    page.fixture.componentInstance['load']().catch(() => null);
    await settle();
    answerError(backend.expectOne('/api/v1/links'), 401, 'AUTHENTICATION_REQUIRED');
    await settle();

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { next: '/', expired: 1 } });
  });
});
