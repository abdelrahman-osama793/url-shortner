import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';

import { Session } from '../../../core/auth/session';
import { CloseAccount } from './close-account';

const settle = () => new Promise((resolve) => setTimeout(resolve));

function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  TestBed.inject(Session).start({
    user: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' },
    csrfToken: 'csrf',
  });

  const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  const fixture = TestBed.createComponent(CloseAccount);

  fixture.componentRef.setInput('email', 'ada@example.com');
  fixture.detectChanges();

  const element: HTMLElement = fixture.nativeElement;
  const click = (label: string) => [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === label)!.click();
  const refresh = async () => {
    await settle();
    fixture.detectChanges();
  };

  return { fixture, element, click, refresh, navigate, backend: TestBed.inject(HttpTestingController) };
}

describe('CloseAccount', () => {
  it('deactivates after confirming, forgets the session and says how to come back', async () => {
    const page = render();

    page.click('Deactivate account');
    await page.refresh();
    expect(page.element.textContent).toContain('Log in again with your email or Google to reactivate');

    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    page.backend.expectOne('/api/v1/account/deactivate').flush(null, { status: 204, statusText: 'No Content' });
    await page.refresh();

    expect(TestBed.inject(Session).signedIn()).toBe(false);
    expect(page.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { closed: 'deactivated' } });
  });

  it('lists what deletion removes and needs the account email typed exactly', async () => {
    const page = render();

    page.click('Delete account');
    await page.refresh();

    expect(page.element.textContent).toContain('all click data and analytics');
    expect(page.element.textContent).toContain('Kept: records of moderation actions');

    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await page.refresh();
    expect(page.element.textContent).toContain('Type your account email exactly to confirm.');
    page.backend.expectNone('/api/v1/account');

    const field = page.element.querySelector<HTMLInputElement>('#delete-confirm-email')!;

    field.value = 'ADA@example.com';
    field.dispatchEvent(new Event('input'));
    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));

    const request = page.backend.expectOne('/api/v1/account');

    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toEqual({ email: 'ADA@example.com' });
    request.flush(null, { status: 204, statusText: 'No Content' });
    await page.refresh();

    expect(page.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { closed: 'deleted' } });
  });

  it('asks the person to confirm it is them when the sign-in is no longer recent', async () => {
    const page = render();

    page.click('Deactivate account');
    await page.refresh();
    page.element.querySelector('form')!.dispatchEvent(new Event('submit'));
    page.backend
      .expectOne('/api/v1/account/deactivate')
      .flush({ error: { code: 'REAUTHENTICATION_REQUIRED', message: 'x' } }, { status: 403, statusText: 'Forbidden' });
    await page.refresh();

    expect(page.element.querySelector('app-confirm-identity')).not.toBeNull();
    expect(TestBed.inject(Session).signedIn()).toBe(true);
  });
});
