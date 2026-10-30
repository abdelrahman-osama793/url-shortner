import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { User } from '@shortlist/contracts';

import { Session } from '../core/auth/session';

import { PublicLayout } from './public-layout';
import { WorkspaceLayout } from './workspace-layout';

function linkTexts(element: HTMLElement): string[] {
  return [...element.querySelectorAll('a')].map((link) => link.textContent?.trim() ?? '');
}

describe('PublicLayout', () => {
  it('always offers Log in, Sign up, a skip link and Report abuse', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });

    const fixture = TestBed.createComponent(PublicLayout);

    fixture.detectChanges();

    const texts = linkTexts(fixture.nativeElement);

    expect(texts).toContain('Log in');
    expect(texts.some((text) => text.startsWith('Sign up'))).toBe(true);
    expect(texts).toContain('Skip to content');
    expect(texts.some((text) => text.startsWith('Report abuse'))).toBe(true);
  });
});

const USER: User = { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' };

function setUp(user: User) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(Session).start({ user, csrfToken: 'csrf' });

  const fixture = TestBed.createComponent(WorkspaceLayout);

  fixture.detectChanges();

  return fixture;
}

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('WorkspaceLayout', () => {
  function sections(user: User): string[] {
    const fixture = setUp(user);

    return [...fixture.nativeElement.querySelectorAll('nav[aria-label="Workspace"] a')].map((link: Element) => link.textContent?.trim() ?? '');
  }

  it('shows the member sections and hides administration from non-admins', () => {
    expect(sections(USER)).toEqual(['Your links', 'Analytics', 'Account']);
  });

  it('adds administration for admins', () => {
    expect(sections({ ...USER, role: 'admin' })).toContain('Administration');
  });

  it('shows the signed-in email, and no verification banner for verified accounts', () => {
    const element: HTMLElement = setUp(USER).nativeElement;

    expect(element.textContent).toContain('ada@example.com');
    expect(element.querySelector('.verify-banner')).toBeNull();
  });

  it('asks unverified accounts to verify, and resends the link', async () => {
    const fixture = setUp({ ...USER, emailVerified: false });
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector('.verify-banner')?.textContent).toContain('Verify your email to create links');

    element.querySelector<HTMLButtonElement>('.verify-banner button')!.click();
    await settle();

    const request = TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/email/resend');

    expect(request.request.body).toEqual({ email: 'ada@example.com' });
    request.flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await settle();
    fixture.detectChanges();

    expect(element.querySelector('.verify-banner')?.textContent).toContain('A new link is on its way');
  });

  it('logs out on the server, forgets the user and returns home', async () => {
    const fixture = setUp(USER);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    [...fixture.nativeElement.querySelectorAll('button')].find((button: HTMLButtonElement) => button.textContent?.includes('Log out'))!.click();
    await settle();
    TestBed.inject(HttpTestingController).expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await settle();

    expect(TestBed.inject(Session).user()).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
