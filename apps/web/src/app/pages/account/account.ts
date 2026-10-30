import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import type { MeResponse } from '@shortlist/contracts';

import { Accounts } from '../../core/auth/accounts';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';
import { GoogleButton } from '../auth/google-button';
import { PasswordField } from '../auth/password-field';

// Connect Google: confirm the Shortlist account first (unless it was confirmed recently), then
// prove the Google account. Both identities must be proven; matching emails link nothing.
type ConnectStep = 'closed' | 'confirm' | 'google';

// The account page (UI_HANDOFF "Account"): email and its verification, sign-in methods with
// the actions the API supports (password reset by email, connect Google), and Log out.
// Unlinking Google, changing the email and adding a password to a Google-only account are
// outside the initial scope, so they are not offered.
@Component({
  selector: 'app-account',
  imports: [Icon, GoogleButton, PasswordField],
  templateUrl: './account.html',
  styleUrl: './account.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountPage {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly session = inject(Session);

  protected readonly summary = signal<MeResponse | null>(null);
  protected readonly loadError = signal<string | null>(null);

  protected readonly step = signal<ConnectStep>('closed');
  protected readonly password = signal('');
  protected readonly confirmError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);

  protected readonly resetState = signal<'idle' | 'sending' | 'sent'>('idle');
  protected readonly resendState = signal<'idle' | 'sending' | 'sent'>('idle');
  protected readonly actionError = signal<string | null>(null);
  protected readonly loggingOut = signal(false);

  private readonly passwordField = viewChild(PasswordField);

  constructor() {
    this.load().catch(() => null);
  }

  protected async load(): Promise<void> {
    this.loadError.set(null);

    try {
      this.summary.set(await this.accounts.summary());
    } catch (error) {
      this.loadError.set(commonMessage(toApiError(error)));
    }
  }

  protected startConnect(): void {
    this.notice.set(null);

    const until = this.summary()?.recentAuthUntil;
    const recent = until !== null && until !== undefined && Date.parse(until) - Date.now() > 30_000;

    this.step.set(recent ? 'google' : 'confirm');
    if (!recent) this.afterRender(() => this.passwordField()?.focus());
  }

  protected cancelConnect(): void {
    this.step.set('closed');
    this.password.set('');
    this.confirmError.set(null);
    this.afterRender(() => this.document.getElementById('connect-google')?.focus());
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    if (!this.password()) {
      this.confirmError.set('Enter your password.');
      return;
    }

    this.busy.set(true);
    this.confirmError.set(null);

    try {
      await this.accounts.reauthenticate(this.password());
      this.password.set('');
      this.step.set('google');
    } catch (error) {
      this.confirmError.set(commonMessage(toApiError(error)));
      this.password.set('');
      this.passwordField()?.focus();
    } finally {
      this.busy.set(false);
    }
  }

  // The confirmation expired between the two steps (the window is a few minutes).
  protected confirmAgain(): void {
    this.notice.set('Please confirm your password again first.');
    this.step.set('confirm');
    this.afterRender(() => this.passwordField()?.focus());
  }

  protected async onLinked(): Promise<void> {
    this.step.set('closed');
    this.notice.set('Google connected. You can now sign in with either method.');
    await this.load();
  }

  private afterRender(action: () => void): void {
    afterNextRender(action, { injector: this.injector });
  }

  protected async sendReset(): Promise<void> {
    const email = this.summary()?.user.email;

    if (!email) return;

    this.resetState.set('sending');
    this.actionError.set(null);

    try {
      await this.accounts.forgotPassword(email);
      this.resetState.set('sent');
    } catch (error) {
      this.resetState.set('idle');
      this.actionError.set(commonMessage(toApiError(error)));
    }
  }

  protected async resendVerification(): Promise<void> {
    const email = this.summary()?.user.email;

    if (!email) return;

    this.resendState.set('sending');
    this.actionError.set(null);

    try {
      await this.accounts.resendVerification(email);
      this.resendState.set('sent');
    } catch (error) {
      this.resendState.set('idle');
      this.actionError.set(commonMessage(toApiError(error)));
    }
  }

  protected async logOut(): Promise<void> {
    this.loggingOut.set(true);
    this.actionError.set(null);

    try {
      await this.session.logOut();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.actionError.set(commonMessage(toApiError(error)));
    } finally {
      this.loggingOut.set(false);
    }
  }
}
