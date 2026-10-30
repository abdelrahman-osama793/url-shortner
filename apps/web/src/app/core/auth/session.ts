import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { LoginResponse, MeResponse, User } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../http/api-error';
import { CsrfToken } from '../http/csrf';

// Who is signed in, as the server sees it. The session itself is the HttpOnly cookie; this only
// mirrors GET /auth/me so screens can show the right navigation. Hiding UI is not authorisation:
// the API checks every request.
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly http = inject(HttpClient);
  private readonly csrf = inject(CsrfToken);

  // undefined until the first check; null when signed out.
  private readonly current = signal<User | null | undefined>(undefined);
  private pending: Promise<User | null> | null = null;

  readonly user = this.current.asReadonly();
  readonly signedIn = computed(() => !!this.current());

  // The signed-in user, asking the server once and sharing the answer between callers.
  async load(): Promise<User | null> {
    const known = this.current();

    if (known !== undefined) return known;

    this.pending ??= this.fetchUser();

    try {
      return await this.pending;
    } finally {
      this.pending = null;
    }
  }

  // Asks the server again, e.g. after the email address was verified.
  async reload(): Promise<User | null> {
    this.current.set(undefined);

    return this.load();
  }

  async logIn(email: string, password: string): Promise<User> {
    const response = await firstValueFrom(this.http.post<LoginResponse>('/api/v1/auth/login', { email, password }));

    return this.start(response);
  }

  // Sign-in returns a new session cookie and the CSRF token that belongs to it.
  start({ user, csrfToken }: LoginResponse): User {
    this.csrf.set(csrfToken);
    this.current.set(user);

    return user;
  }

  // The server said the session is gone (expired or revoked elsewhere).
  forget(): void {
    this.csrf.clear();
    this.current.set(null);
  }

  async logOut(): Promise<void> {
    await firstValueFrom(this.http.post('/api/v1/auth/logout', null));

    this.forget();
  }

  private async fetchUser(): Promise<User | null> {
    try {
      const { user } = await firstValueFrom(this.http.get<MeResponse>('/api/v1/auth/me'));

      this.current.set(user);

      return user;
    } catch (error) {
      if (toApiError(error).status !== 401) throw toApiError(error);

      this.current.set(null);

      return null;
    }
  }
}
