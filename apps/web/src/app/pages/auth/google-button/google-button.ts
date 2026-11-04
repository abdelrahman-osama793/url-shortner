import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { User } from '@shortlist/contracts';

import { type GoogleIdentity, type GooglePurpose, GoogleSignIn } from '../../../core/auth/google';
import { Consent } from '../../../core/consent';
import { Theme } from '../../../core/theme';
import { Session } from '../../../core/auth/session';
import { commonMessage, toApiError } from '../../../core/http/api-error';

// Google's own "Continue with Google" button (Google Identity Services). For sign-in it is
// followed by the "or continue with email" divider; for linking (account page) it connects the
// chosen Google account to the signed-in account. Hidden entirely when the server has no Google
// client. Each attempt's nonce is prepared before the click, and renewed before it expires.
// Google's script sets Google's cookies, so it loads only with "google" consent; until then the
// visitor gets a button that grants it.
const GOOGLE_MESSAGES: Record<string, string> = {
  // Sign-in with Google whose email belongs to a password account: linking needs both proven.
  ACCOUNT_LINK_REQUIRED:
    'An account with this email already exists. Log in with your email and password, then connect Google from your account page.',
  GOOGLE_ACCOUNT_IN_USE: 'That Google account is already connected to a different Shortlist account.',
  GOOGLE_ALREADY_LINKED: 'A different Google account is already connected to this account.',
};

@Component({
  selector: 'app-google-button',
  imports: [RouterLink],
  templateUrl: './google-button.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleButton {
  private readonly google = inject(GoogleSignIn);
  private readonly session = inject(Session);
  private readonly consent = inject(Consent);
  private readonly injector = inject(Injector);
  private readonly theme = inject(Theme);

  readonly text = input<'continue_with' | 'signup_with'>('continue_with');
  readonly purpose = input<GooglePurpose>('login');
  readonly signedIn = output<User>();
  readonly linked = output<void>();
  readonly reauthenticated = output<void>();
  // Linking was refused because the session is no longer recently authenticated.
  readonly confirmationNeeded = output<void>();

  protected readonly state = signal<'loading' | 'consent' | 'ready' | 'unavailable' | 'failed'>('loading');
  protected readonly error = signal<string | null>(null);

  private readonly host = viewChild<ElementRef<HTMLElement>>('host');
  private renewal: ReturnType<typeof setTimeout> | undefined;
  private drawn: { identity: GoogleIdentity; host: HTMLElement } | null = null;

  constructor() {
    afterNextRender(() => void this.setUp());
    inject(DestroyRef).onDestroy(() => clearTimeout(this.renewal));

    // Google draws its own button, so it is redrawn in its dark style when the page turns dark.
    effect(() => {
      this.theme.dark();
      untracked(() => this.draw());
    });
  }

  protected allowGoogle(): void {
    this.consent.grant('google');
    this.state.set('loading');
    // The button's container appears only once 'loading' has rendered.
    afterNextRender(() => void this.setUp(), { injector: this.injector });
  }

  private async setUp(): Promise<void> {
    clearTimeout(this.renewal);

    try {
      const attempt = await this.google.prepare(this.purpose());

      if (!attempt) {
        this.state.set('unavailable');
        return;
      }

      if (!this.consent.allows('google')) {
        this.state.set('consent');
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
      this.drawn = { identity, host };
      this.draw();

      this.state.set('ready');
      // Attempts last five minutes on the server; prepare a new one before this one expires.
      this.renewal = setTimeout(() => void this.setUp(), 4 * 60 * 1000 + 5000);
    } catch {
      this.state.set('failed');
    }
  }

  // The button's language follows the page (<html lang>), not the browser's own setting; its
  // style follows the page's appearance (outline on light, filled black on dark).
  private draw(): void {
    if (!this.drawn) return;

    const { identity, host } = this.drawn;

    host.replaceChildren();
    identity.renderButton(host, {
      theme: this.theme.dark() ? 'filled_black' : 'outline',
      size: 'large',
      text: this.text(),
      width: Math.min(400, host.clientWidth || 360),
      locale: host.ownerDocument.documentElement.lang || 'en',
    });
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
