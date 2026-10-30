import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { GoogleStartResponse, LoginResponse } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../http/api-error';

// The parts of Google Identity Services (https://accounts.google.com/gsi/client) we use.
interface GoogleIdentity {
  initialize(options: { client_id: string; nonce: string; callback: (response: { credential: string }) => void; ux_mode?: 'popup' }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

type GoogleWindow = Window & { google?: { accounts?: { id?: GoogleIdentity } } };

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

// Server attempts last five minutes; a prepared one is reused for four, so moving between
// Log in and Sign up does not start a new attempt every time (they are rate-limited).
const REUSE_MS = 4 * 60 * 1000;

// Google sign-in (decision D07, technical-design "Google"): the server starts a browser-bound
// attempt with a one-time nonce; Google signs an ID token containing that nonce; the server
// verifies the token and starts a session. The browser never sees a Google password and never
// chooses which account is signed in to.
@Injectable({ providedIn: 'root' })
export class GoogleSignIn {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);

  private attempt: { value: GoogleStartResponse; at: number } | null = null;
  private script: Promise<GoogleIdentity> | null = null;

  // A fresh or recent attempt, or null when Google sign-in is not configured on the server.
  async prepare(): Promise<GoogleStartResponse | null> {
    if (this.attempt && Date.now() - this.attempt.at < REUSE_MS) return this.attempt.value;

    try {
      const value = await firstValueFrom(this.http.post<GoogleStartResponse>('/api/v1/auth/google/start', { purpose: 'login' }));

      this.attempt = { value, at: Date.now() };

      return value;
    } catch (error) {
      if (toApiError(error).status === 404) return null;

      throw toApiError(error);
    }
  }

  // Exchanges Google's ID token for a session. The attempt is used up either way.
  async signIn(attemptId: string, credential: string): Promise<LoginResponse> {
    this.attempt = null;

    return firstValueFrom(this.http.post<LoginResponse>('/api/v1/auth/google', { attemptId, credential }));
  }

  // Loads Google's script once. Rejects if it is blocked or offline.
  identity(): Promise<GoogleIdentity> {
    this.script ??= this.loadScript().catch((error: unknown) => {
      this.script = null;
      throw error;
    });

    return this.script;
  }

  private async loadScript(): Promise<GoogleIdentity> {
    const loaded = () => (this.document.defaultView as GoogleWindow | null)?.google?.accounts?.id;

    if (!loaded()) {
      // A <script> element reports only through load/error events, so this one place wraps them.
      await new Promise<void>((resolve, reject) => {
        const script = this.document.createElement('script');

        script.src = SCRIPT_URL;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
        this.document.head.appendChild(script);
      });
    }

    const identity = loaded();

    if (!identity) throw new Error('Google sign-in could not be loaded.');

    return identity;
  }
}
