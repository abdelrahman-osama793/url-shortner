import { HttpClient, HttpErrorResponse, HttpHeaders, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { describeWait, toApiError } from './api-error';
import { csrfInterceptor } from './csrf.interceptor';

describe('csrfInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([csrfInterceptor])), provideHttpClientTesting()],
    });

    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
  });

  afterEach(() => backend.verify());

  // Lets pending promise callbacks (token fetch → request) run between backend flushes.
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

  it('fetches the CSRF token once and sends it on state-changing API requests', async () => {
    const first = firstValueFrom(http.post('/api/v1/links', {}));

    backend.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'token-1' });
    await tick();

    const firstPost = backend.expectOne('/api/v1/links');

    expect(firstPost.request.headers.get('X-CSRF-Token')).toBe('token-1');
    firstPost.flush({});
    await first;

    const second = firstValueFrom(http.post('/api/v1/links', {}));

    await tick();
    backend.expectNone('/api/v1/auth/csrf');

    const secondPost = backend.expectOne('/api/v1/links');

    expect(secondPost.request.headers.get('X-CSRF-Token')).toBe('token-1');
    secondPost.flush({});
    await second;
  });

  it('leaves GET requests and non-API requests alone', async () => {
    const get = firstValueFrom(http.get('/api/v1/links'));
    const external = firstValueFrom(http.post('https://example.com/form', {}));

    const getRequest = backend.expectOne('/api/v1/links');
    const externalRequest = backend.expectOne('https://example.com/form');

    expect(getRequest.request.headers.has('X-CSRF-Token')).toBe(false);
    expect(externalRequest.request.headers.has('X-CSRF-Token')).toBe(false);
    backend.expectNone('/api/v1/auth/csrf');

    getRequest.flush({});
    externalRequest.flush({});
    await Promise.all([get, external]);
  });

  it('refreshes the token and retries once when the server rejects it', async () => {
    const result = firstValueFrom(http.post<{ ok: boolean }>('/api/v1/links', {}));

    backend.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'stale' });
    await tick();
    backend.expectOne('/api/v1/links').flush({ error: { code: 'CSRF_INVALID', message: 'x', requestId: 'r' } }, { status: 403, statusText: 'Forbidden' });
    await tick();
    backend.expectOne('/api/v1/auth/csrf').flush({ csrfToken: 'fresh' });
    await tick();

    const retry = backend.expectOne('/api/v1/links');

    expect(retry.request.headers.get('X-CSRF-Token')).toBe('fresh');
    retry.flush({ ok: true });

    expect(await result).toEqual({ ok: true });
  });
});

describe('toApiError', () => {
  it('reads the error envelope, field errors and Retry-After', () => {
    const error = toApiError(new HttpErrorResponse({
      status: 429,
      headers: new HttpHeaders({ 'Retry-After': '120' }),
      error: { error: { code: 'RATE_LIMITED', message: 'Slow down', requestId: 'r', fields: [{ path: 'a', message: 'b' }] } },
    }));

    expect([error.status, error.code, error.message, error.retryAfterSeconds]).toEqual([429, 'RATE_LIMITED', 'Slow down', 120]);
    expect(error.fieldMessage('a')).toBe('b');
  });

  it('reports a request that never got an answer as a network error', () => {
    expect(toApiError(new HttpErrorResponse({ status: 0 })).code).toBe('NETWORK_ERROR');
  });

  it('describes waits in plain language', () => {
    expect([describeWait(30), describeWait(600), describeWait(7200)]).toEqual(['about a minute', 'about 10 minutes', 'about 2 hours']);
  });
});
