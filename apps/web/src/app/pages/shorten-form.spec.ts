import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CsrfToken } from '../core/http/csrf';
import { ShortenForm } from './shorten-form';

const RESULT = { code: 'Ab3dE5fG', shortUrl: 'http://localhost:4200/r/Ab3dE5fG', expiresAt: '2026-11-05T12:00:00.000Z' };

describe('ShortenForm', () => {
  let fixture: ComponentFixture<ShortenForm>;
  let backend: HttpTestingController;
  let element: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });

    // The CSRF flow is covered by the interceptor tests; here a token is already known.
    TestBed.inject(CsrfToken).set('token');

    fixture = TestBed.createComponent(ShortenForm);
    backend = TestBed.inject(HttpTestingController);
    element = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => backend.verify());

  const settle = async () => {
    await new Promise<void>((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  };

  async function submit(url: string): Promise<void> {
    const input = element.querySelector<HTMLInputElement>('#destination')!;

    input.value = url;
    input.dispatchEvent(new Event('input'));
    element.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
  }

  function answer(body: object, status = 201, headers: Record<string, string> = {}): void {
    backend.expectOne('/api/v1/links').flush(body, { status, statusText: 'x', headers });
  }

  const text = () => element.textContent ?? '';

  it('sends the destination and shows the real short link with its expiry', async () => {
    await submit('  https://example.com/page  ');

    const request = backend.expectOne('/api/v1/links');

    expect(request.request.body).toEqual({ destinationUrl: 'https://example.com/page', challengeToken: undefined });
    request.flush(RESULT, { status: 201, statusText: 'Created' });
    await settle();

    expect(element.querySelector<HTMLInputElement>('#short-url')!.value).toBe(RESULT.shortUrl);
    expect(text()).toContain('expires');
    expect(text()).toContain('2026');
  });

  it('asks for a link instead of sending an empty form', async () => {
    await submit('   ');

    backend.expectNone('/api/v1/links');
    expect(text()).toContain('Paste the link you want to shorten.');
  });

  it('shows the server\'s reason for an invalid destination on the field', async () => {
    await submit('http://localhost/admin');
    answer({ error: { code: 'VALIDATION_FAILED', message: 'Some fields are invalid.', requestId: 'r', fields: [{ path: 'destinationUrl', message: 'Local and private network addresses cannot be shortened.' }] } }, 400);
    await settle();

    const input = element.querySelector('#destination')!;

    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(element.querySelector('#destination-error')!.textContent).toContain('Local and private network addresses');
  });

  it('explains how long to wait when rate-limited', async () => {
    await submit('https://example.com');
    answer({ error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } }, 429, { 'Retry-After': '1800' });
    await settle();

    expect(text()).toContain('try again in about 30 minutes');
  });

  it('asks for verification when the server requires a challenge, then retries with the token', async () => {
    await submit('https://example.com');
    answer({ error: { code: 'CHALLENGE_REQUIRED', message: 'Please complete the verification to continue.', requestId: 'r' } }, 403);
    await settle();

    expect(text()).toContain('Quick check');
    expect(text()).toContain('Development mock');
    expect(document.activeElement?.textContent).toContain('Complete verification');

    [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Complete verification'))!.click();
    await settle();

    backend.expectOne('/api/v1/dev/challenge-token').flush({ challengeToken: 'mock-token' }, { status: 201, statusText: 'Created' });
    await settle();

    const retry = backend.expectOne('/api/v1/links');

    expect(retry.request.body).toEqual({ destinationUrl: 'https://example.com', challengeToken: 'mock-token' });
    retry.flush(RESULT, { status: 201, statusText: 'Created' });
    await settle();

    expect(element.querySelector<HTMLInputElement>('#short-url')!.value).toBe(RESULT.shortUrl);
  });

  it('reports outages and lost connections without blaming the visitor', async () => {
    await submit('https://example.com');
    answer({ error: { code: 'SERVICE_UNAVAILABLE', message: 'x', requestId: 'r' } }, 503);
    await settle();
    expect(text()).toContain('briefly unavailable');

    await submit('https://example.com');
    backend.expectOne('/api/v1/links').error(new ProgressEvent('error'));
    await settle();
    expect(text()).toContain("couldn't reach Shortlist");
  });

  describe('copying', () => {
    async function showResult(): Promise<void> {
      await submit('https://example.com');
      answer(RESULT);
      await settle();
    }

    function clickCopy(): void {
      [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Copy'))!.click();
    }

    it('copies the short link and confirms it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);

      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

      try {
        await showResult();
        clickCopy();
        await settle();

        expect(writeText).toHaveBeenCalledWith(RESULT.shortUrl);
        expect(text()).toContain('Copied');
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('leaves the link selected with instructions when the clipboard is unavailable', async () => {
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

      try {
        await showResult();
        clickCopy();
        await settle();

        const field = element.querySelector<HTMLInputElement>('#short-url')!;

        expect(text()).toContain("Copying isn't available here");
        expect(field.value).toBe(RESULT.shortUrl);
        expect(field.readOnly).toBe(true);
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('returns focus to the field when the challenge is cancelled', async () => {
    await submit('https://example.com');
    answer({ error: { code: 'CHALLENGE_REQUIRED', message: 'x', requestId: 'r' } }, 403);
    await settle();

    [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Cancel'))!.click();
    await settle();

    expect(document.activeElement?.id).toBe('destination');
    expect(text()).not.toContain('Quick check');
  });

  it('leaves the challenge step when the verified retry is rate-limited', async () => {
    await submit('https://example.com');
    answer({ error: { code: 'CHALLENGE_REQUIRED', message: 'x', requestId: 'r' } }, 403);
    await settle();

    [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Complete verification'))!.click();
    await settle();
    backend.expectOne('/api/v1/dev/challenge-token').flush({ challengeToken: 'mock-token' }, { status: 201, statusText: 'Created' });
    await settle();
    answer({ error: { code: 'RATE_LIMITED', message: 'x', requestId: 'r' } }, 429, { 'Retry-After': '60' });
    await settle();

    expect(text()).not.toContain('Quick check');
    expect(text()).toContain('try again in');
    expect(document.activeElement?.id).toBe('destination');
  });

  it('moves focus to the new short link, and back to an empty field to start over', async () => {
    document.body.appendChild(element);

    try {
      await submit('https://example.com');
      answer(RESULT);
      await settle();

      expect(document.activeElement?.id).toBe('short-url');

      [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('Shorten another'))!.click();
      await settle();

      expect(element.querySelector<HTMLInputElement>('#destination')!.value).toBe('');
      expect(document.activeElement?.id).toBe('destination');
    } finally {
      element.remove();
    }
  });
});
