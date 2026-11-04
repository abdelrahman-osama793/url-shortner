import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../../core/auth/session';
import { Home } from './home';

function render(signedIn: boolean): HTMLElement {
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });

  if (signedIn) {
    TestBed.inject(Session).start({
      user: { id: '00000000-0000-4000-8000-000000000001', email: 'ada@example.com', emailVerified: true, role: 'user', status: 'active' },
      csrfToken: 'csrf',
    });
  }

  const fixture = TestBed.createComponent(Home);

  fixture.detectChanges();

  return fixture.nativeElement;
}

const hrefs = (element: HTMLElement) => [...element.querySelectorAll('a')].map((link) => link.getAttribute('href'));

describe('Home', () => {
  it('explains the product and invites visitors to sign up', () => {
    const element = render(false);

    expect(element.querySelector('#how-title')?.textContent).toBe('How it works');
    expect(element.querySelectorAll('.compare tbody tr').length).toBe(6);
    expect(hrefs(element)).toContain('/signup');
  });

  it('sends signed-in users to their links and never offers them sign-up', () => {
    const element = render(true);

    expect(hrefs(element)).toContain('/app/links');
    expect(hrefs(element)).not.toContain('/signup');
  });
});
