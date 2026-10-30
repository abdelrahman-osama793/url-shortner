import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AdminLink, AdminReport, MeResponse, User } from '@shortlist/contracts';

import { requireAdmin } from '../../core/auth/guards';
import { Session } from '../../core/auth/session';

import { AdminPage } from './admin';

const ADMIN: User = { id: '00000000-0000-4000-8000-0000000000ad', email: 'admin@example.com', emailVerified: true, role: 'admin', status: 'active' };
const OWNER_ID = '00000000-0000-4000-8000-0000000000b0';

const REPORT: AdminReport = {
  id: '00000000-0000-4000-8000-0000000000e1',
  linkId: '00000000-0000-4000-8000-0000000000c1',
  code: 'Abc123',
  category: 'phishing',
  details: 'Fake bank login.',
  status: 'open',
  reporterId: null,
  createdAt: '2026-10-30T10:00:00.000Z',
  resolvedAt: null,
  resolvedBy: null,
};

function linkOf(overrides: Partial<AdminLink> = {}): AdminLink {
  return {
    id: REPORT.linkId,
    code: 'Abc123',
    shortUrl: 'http://localhost:4200/r/Abc123',
    destinationUrl: 'https://bank.example.net/login',
    ownerId: OWNER_ID,
    ownerStatus: 'active',
    enabled: true,
    expiresAt: null,
    blockedAt: null,
    blockReason: null,
    effectiveStatus: 'active',
    openReports: 1,
    version: 3,
    createdAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve));
const page = (items: unknown[] = [], nextCursor: string | null = null) => ({ items, nextCursor });

let backend: HttpTestingController;

function setUp(user: User = ADMIN) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(Session).start({ user, csrfToken: 'csrf' });
  backend = TestBed.inject(HttpTestingController);
}

const isAudit = (req: { url: string }) => req.url === '/api/v1/admin/audit';

// Answers every pending audit request (history and recent activity) with an empty page.
function answerAudits(): void {
  for (const request of backend.match(isAudit)) request.flush(page());
}

async function render() {
  setUp();

  const fixture = TestBed.createComponent(AdminPage);
  const element: HTMLElement = fixture.nativeElement;

  fixture.detectChanges();
  backend.expectOne((req) => req.url === '/api/v1/admin/reports' && req.params.get('status') === 'open').flush(page([REPORT]));
  answerAudits();
  await settle();
  fixture.detectChanges();

  const refresh = async () => {
    await settle();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const view = {
    element,
    refresh,
    text: () => element.textContent?.replace(/\s+/g, ' ') ?? '',
    button: (label: string) => [...element.querySelectorAll('button')].find((button) => button.textContent?.trim() === label),
    async click(label: string) {
      view.button(label)!.click();
      await refresh();
    },
    async reason(value: string) {
      const field = element.querySelector<HTMLTextAreaElement>('#action-reason')!;

      field.value = value;
      field.dispatchEvent(new Event('input'));
      element.querySelector('app-moderation-action form')!.dispatchEvent(new Event('submit'));
      await refresh();
    },
    async openReport(link = linkOf()) {
      element.querySelector<HTMLButtonElement>('.report-item')!.click();
      await settle();
      backend.expectOne((req) => req.url === '/api/v1/admin/links' && req.params.get('code') === 'Abc123').flush(link);
      await settle();
      answerAudits();
      await refresh();
    },
  };

  return view;
}

describe('requireAdmin', () => {
  it('sends non-admins to their links, and lets admins in', async () => {
    setUp({ ...ADMIN, role: 'user' });

    const refused = await TestBed.runInInjectionContext(() => requireAdmin({} as never, {} as never));

    expect(String(refused)).toBe('/app/links');

    TestBed.resetTestingModule();
    setUp();

    expect(await TestBed.runInInjectionContext(() => requireAdmin({} as never, {} as never))).toBe(true);
  });
});

describe('AdminPage', () => {
  it('lists open reports and shows the report with its link, owner and history', async () => {
    const view = await render();

    expect(view.text()).toContain('/r/Abc123');
    expect(view.text()).toContain('Phishing');

    await view.openReport();

    expect(view.text()).toContain('Fake bank login.');
    expect(view.text()).toContain('https://bank.example.net/login');
    expect(view.text()).toContain(OWNER_ID);
    expect(view.button('Resolve')).toBeTruthy();
    expect(view.button('Block link')).toBeTruthy();
    expect(view.button('Suspend owner')).toBeTruthy();
  });

  it('switches the queue to another status', async () => {
    const view = await render();

    await view.click('Resolved');
    backend.expectOne((req) => req.url === '/api/v1/admin/reports' && req.params.get('status') === 'resolved').flush(page());
    await view.refresh();

    expect(view.text()).toContain('No resolved reports.');
  });

  it('resolves a report with a required note, without touching the link', async () => {
    const view = await render();

    await view.openReport();
    await view.click('Resolve');
    await view.reason('   ');

    expect(view.text()).toContain('Give a reason.');
    backend.expectNone((req) => req.method === 'PATCH');

    await view.reason('Checked: the page is a real bank.');

    const patch = backend.expectOne((req) => req.method === 'PATCH');

    expect(patch.request.url).toBe(`/api/v1/admin/reports/${REPORT.id}`);
    expect(patch.request.body).toEqual({ status: 'resolved', note: 'Checked: the page is a real bank.' });
    patch.flush({ ...REPORT, status: 'resolved', resolvedAt: '2026-10-30T11:00:00.000Z', resolvedBy: ADMIN.id });
    await settle();
    backend.expectOne((req) => req.url === '/api/v1/admin/links').flush(linkOf({ openReports: 0 }));
    await settle();
    answerAudits();
    await view.refresh();

    expect(view.text()).toContain('The link was not changed.');
    expect(view.element.querySelector('.report-item')).toBeNull();
    backend.expectNone((req) => req.url.includes('/moderation'));
  });

  it('blocks a link with its version, asking to confirm identity first when needed, then retrying', async () => {
    const view = await render();

    await view.openReport();
    await view.click('Block link');
    await view.reason('Phishing kit');

    const first = backend.expectOne((req) => req.method === 'PATCH');

    expect(first.request.url).toBe(`/api/v1/admin/links/${REPORT.linkId}/moderation`);
    expect(first.request.headers.get('If-Match')).toBe('"v3"');
    expect(first.request.body).toEqual({ blocked: true, reason: 'Phishing kit' });
    first.flush({ error: { code: 'REAUTHENTICATION_REQUIRED', message: 'x' } }, { status: 403, statusText: 'x' });
    await view.refresh();

    const summary: MeResponse = { user: ADMIN, signInMethods: { password: true, google: false }, recentAuthUntil: null };

    backend.expectOne('/api/v1/auth/me').flush(summary);
    await view.refresh();

    expect(view.text()).toContain("Confirm it's you");

    const password = view.element.querySelector<HTMLInputElement>('#confirm-identity-password')!;

    password.value = 'admin password';
    password.dispatchEvent(new Event('input'));
    view.element.querySelector('app-confirm-identity form')!.dispatchEvent(new Event('submit'));
    await settle();
    backend.expectOne('/api/v1/auth/reauthenticate').flush(null, { status: 204, statusText: 'No Content' });
    await view.refresh();

    const retry = backend.expectOne((req) => req.method === 'PATCH');

    expect(retry.request.body).toEqual({ blocked: true, reason: 'Phishing kit' });
    retry.flush(linkOf({ blockedAt: '2026-10-30T11:00:00.000Z', blockReason: 'Phishing kit', effectiveStatus: 'blocked', version: 4 }));
    await settle();
    backend.expectOne((req) => req.url === '/api/v1/admin/links').flush(linkOf({ blockedAt: '2026-10-30T11:00:00.000Z', blockReason: 'Phishing kit', effectiveStatus: 'blocked', version: 4 }));
    await settle();
    answerAudits();
    await view.refresh();

    expect(view.text()).toContain('Link blocked.');
    expect(view.button('Unblock link')).toBeTruthy();
  });

  it('reloads the link when it changed elsewhere and explains it', async () => {
    const view = await render();

    await view.openReport();
    await view.click('Block link');
    await view.reason('Phishing kit');
    backend.expectOne((req) => req.method === 'PATCH').flush({ error: { code: 'PRECONDITION_FAILED', message: 'This link was changed elsewhere. Reload it and try again.' } }, { status: 412, statusText: 'x' });
    await settle();
    backend.expectOne((req) => req.url === '/api/v1/admin/links').flush(linkOf({ version: 5, enabled: false, effectiveStatus: 'disabled' }));
    await settle();
    answerAudits();
    await view.refresh();

    expect(view.text()).toContain('This link was changed elsewhere');
    expect(view.text()).toContain('Disabled by the owner');
  });

  it('suspends the owner and shows refusals from the server', async () => {
    const view = await render();

    await view.openReport();
    await view.click('Suspend owner');
    await view.reason('Spam campaign');

    const patch = backend.expectOne((req) => req.method === 'PATCH');

    expect(patch.request.url).toBe(`/api/v1/admin/users/${OWNER_ID}/moderation`);
    expect(patch.request.body).toEqual({ suspended: true, reason: 'Spam campaign' });
    patch.flush({ error: { code: 'LAST_ACTIVE_ADMIN', message: 'This is the last active administrator.' } }, { status: 409, statusText: 'x' });
    await view.refresh();

    expect(view.text()).toContain('This is the last active administrator.');
  });

  it('offers no account actions for a guest link, and explains an unknown code', async () => {
    const view = await render();

    await view.openReport(linkOf({ ownerId: null, ownerStatus: null }));

    expect(view.text()).toContain('Guest link (no account)');
    expect(view.button('Suspend owner')).toBeUndefined();

    const lookup = view.element.querySelector<HTMLInputElement>('#lookup-code')!;

    lookup.value = 'http://localhost:4200/r/Nope42';
    lookup.dispatchEvent(new Event('input'));
    view.element.querySelector('form[role="search"]')!.dispatchEvent(new Event('submit'));
    await settle();
    backend.expectOne((req) => req.url === '/api/v1/admin/links' && req.params.get('code') === 'Nope42').flush({ error: { code: 'NOT_FOUND' } }, { status: 404, statusText: 'x' });
    await view.refresh();

    expect(view.text()).toContain('No link has the code "Nope42". Codes are case-sensitive.');
  });
});
