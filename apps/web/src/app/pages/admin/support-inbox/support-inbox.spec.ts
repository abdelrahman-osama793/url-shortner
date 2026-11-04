import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { SupportInbox } from './support-inbox';

const settle = () => new Promise((resolve) => setTimeout(resolve));

const MESSAGE = {
  id: '00000000-0000-4000-8000-0000000000a1',
  userId: null,
  replyEmail: 'guest@example.com',
  topic: 'links',
  message: 'How do I change a link?',
  status: 'open',
  createdAt: '2026-11-04T10:00:00.000Z',
  closedAt: null,
  closedBy: null,
};

describe('SupportInbox', () => {
  it('lists open messages with a reply link, and closing one removes it from the list', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });

    const fixture = TestBed.createComponent(SupportInbox);
    const backend = TestBed.inject(HttpTestingController);
    const element: HTMLElement = fixture.nativeElement;

    backend.expectOne((request) => request.url === '/api/v1/admin/support' && request.params.get('status') === 'open').flush({ items: [MESSAGE], nextCursor: null });
    await settle();
    fixture.detectChanges();

    expect(element.textContent).toContain('How do I change a link?');
    expect(element.querySelector('a')!.getAttribute('href')).toBe('mailto:guest@example.com');

    [...element.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Close')!.click();

    const close = backend.expectOne(`/api/v1/admin/support/${MESSAGE.id}`);

    expect(close.request.body).toEqual({ status: 'closed' });
    close.flush({ ...MESSAGE, status: 'closed' });
    await settle();
    fixture.detectChanges();

    expect(element.textContent).toContain('No open messages.');
  });
});
