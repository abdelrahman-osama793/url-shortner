import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';
import type { User } from '@shortlist/contracts';

import { type GooglePurpose, GoogleSignIn } from '../../core/auth/google';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';

// Google's own "Continue with Google" button (Google Identity Services). For sign-in it is
// followed by the "or continue with email" divider; for linking (account page) it connects the
// chosen Google account to the signed-in account. Hidden entirely when the server has no Google
// client. Each attempt's nonce is prepared before the click, and renewed before it expires.
const GOOGLE_MESSAGES: Record<string, string> = {
  // Sign-in with Google whose email belongs to a password account: linking needs both proven.
  ACCOUNT_LINK_REQUIRED:
    'An account with this email already exists. Log in with your email and password, then connect Google from your account page.',
  GOOGLE_ACCOUNT_IN_USE: 'That Google account is already connected to a different Shortlist account.',
  GOOGLE_ALREADY_LINKED: 'A different Google account is already connected to this account.',
};

@Component({
  selector: 'app-google-button',
  template: `
    @if (state() !== 'unavailable') {
      @if (state() === 'failed') {
        <p class="note">Google sign-in couldn't load here. You can use your email instead.</p>
      } @else {
        <div #host class="google-slot" [attr.aria-busy]="state() === 'loading'"></div>
      }
      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }
      @if (purpose() === 'login') {
        <div class="divider">or continue with email</div>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleButton {
  private readonly google = inject(GoogleSignIn);
  private readonly session = inject(Session);

  readonly text = input<'continue_with' | 'signup_with'>('continue_with');
  readonly purpose = input<GooglePurpose>('login');
  readonly signedIn = output<User>();
  readonly linked = output<void>();
  readonly reauthenticated = output<void>();
  // Linking was refused because the session is no longer recently authenticated.
  readonly confirmationNeeded = output<void>();

  protected readonly state = signal<'loading' | 'ready' | 'unavailable' | 'failed'>('loading');
  protected readonly error = signal<string | null>(null);

  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private renewal: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => void this.setUp());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.renewal));
  }

  private async setUp(): Promise<void> {
    clearTimeout(this.renewal);

    try {
      const attempt = await this.google.prepare(this.purpose());

      if (!attempt) {
        this.state.set('unavailable');
        return;
      }

      const identity = await this.google.identity();
      const host = this.host()?.nativeElement;

      if (!host) return;

      identity.initialize({
        client_id: attempt.clientId,
        nonce: attempt.nonce,
        ux_mode: 'popup',
        callback: ({ credential }) => void this.complete(attempt.attemptId, credential),
      });
      // The button's language follows the page (<html lang>), not the browser's own setting.
      identity.renderButton(host, {
        theme: 'outline',
        size: 'large',
        text: this.text(),
        width: Math.min(400, host.clientWidth || 360),
        locale: host.ownerDocument.documentElement.lang || 'en',
      });

      this.state.set('ready');
      // Attempts last five minutes on the server; prepare a new one before this one expires.
      this.renewal = setTimeout(() => void this.setUp(), 4 * 60 * 1000 + 5000);
    } catch {
      this.state.set('failed');
    }
  }

  private async complete(attemptId: string, credential: string): Promise<void> {
    this.error.set(null);

    try {
      if (this.purpose() === 'link') {
        await this.google.link(attemptId, credential);
        this.linked.emit();
        return;
      }

      if (this.purpose() === 'reauthenticate') {
        await this.google.reauthenticate(attemptId, credential);
        this.reauthenticated.emit();
        return;
      }

      this.signedIn.emit(this.session.start(await this.google.signIn(attemptId, credential)));
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'REAUTHENTICATION_REQUIRED') {
        this.confirmationNeeded.emit();
        return;
      }

      // Re-authentication accepts only the Google account already linked to this account.
      const wrongAccount = this.purpose() === 'reauthenticate' && apiError.code === 'GOOGLE_SIGN_IN_FAILED';

      this.error.set(wrongAccount
        ? "That isn't the Google account connected to this account. Choose the connected one."
        : GOOGLE_MESSAGES[apiError.code] ?? commonMessage(apiError));

      await this.setUp();
    }
  }
}
