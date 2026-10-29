import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CsrfResponse } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

// The CSRF token of this browser's session (api-contracts.md, Conventions). GET /auth/csrf also
// creates the anonymous session cookie on first use. Concurrent callers share one request.
// Sign-in and sign-out replace the token (T25) through `set`.
@Injectable({ providedIn: 'root' })
export class CsrfToken {
  private readonly http = inject(HttpClient);

  private token: string | null = null;
  private pending: Promise<string> | null = null;

  async get(): Promise<string> {
    if (this.token) return this.token;

    this.pending ??= this.fetch();

    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  // Forgets the current token and fetches a fresh one (after a session expired or changed).
  async refresh(): Promise<string> {
    this.token = null;

    return this.get();
  }

  set(token: string): void {
    this.token = token;
  }

  private async fetch(): Promise<string> {
    const { csrfToken } = await firstValueFrom(this.http.get<CsrfResponse>('/api/v1/auth/csrf'));

    this.token = csrfToken;

    return csrfToken;
  }
}
