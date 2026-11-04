import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../../core/auth/session';
import { ContactPage } from './contact';

const settle = () => new Promise((resolve) => setTimeout(resolve));

function render(signedIn: boolean) {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });

  if (signedIn) {
    TestBed.inject(Session).start({
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' },
      csrfToken: 'csrf',
    });
  }

  const fixture = TestBed.createComponent(ContactPage);
  const element: HTMLElement = fixture.nativeElement;

  fixture.detectChanges();

  const type = (selector: string, value: string) => {
    const field = element.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;

    field.value = value;
    field.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    fixture.detectChanges();
  };

  return { fixture, element, type, submit, backend: TestBed.inject(HttpTestingController) };
}

describe('ContactPage', () => {
  it('sends abuse to the report form', () => {
    const { element } = render(false);

    expect([...element.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('/report');
  });

  it('asks a guest for a reply address before sending, then sends it', async () => {
    const page = render(false);

    page.type('#support-message', 'How do I change a link?');
    await page.submit();

    expect(page.element.textContent).toContain('Enter the email address we should reply to.');
    page.backend.expectNone('/api/v1/support');

    page.type('#support-email', 'guest@example.com');
    await page.submit();

    const request = page.backend.expectOne('/api/v1/support');

    expect(request.request.body).toEqual({ topic: 'account', message: 'How do I change a link?', email: 'guest@example.com' });
    request.flush({ status: 'accepted' }, { status: 202, statusText: 'Accepted' });
    await settle();
    page.fixture.detectChanges();

    expect(page.element.textContent).toContain('Message sent');
  });

  it('answers signed-in people at their account email, without asking for one', async () => {
    const page = render(true);

    expect(page.element.querySelector('#support-email')).toBeNull();
    expect(page.element.textContent).toContain('ada@example.com');

    page.type('#support-message', 'Help with my links');
    await page.submit();

    expect(page.backend.expectOne('/api/v1/support').request.body).toEqual({ topic: 'account', message: 'Help with my links' });
  });
});
