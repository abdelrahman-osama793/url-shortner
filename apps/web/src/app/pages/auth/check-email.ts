import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../core/auth/accounts';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

// After sign-up, or when a verification link expired: explains the next step and resends the
// link. The address comes from sign-up's navigation state or the signed-in user; otherwise the
// visitor types it. The answer never says whether the address has an account.
@Component({
  selector: 'app-check-email',
  imports: [RouterLink, Icon],
  template: `
    <div class="mark"><app-icon name="mail" /></div>
    <h1>Verify your email</h1>
    <p class="auth-intro">
      Open the verification link we sent
      @if (knownEmail) {
        to <strong>{{ knownEmail }}</strong>
      }
      to finish setting up your account. The link expires after 24 hours.
    </p>

    <form class="form-stack" (submit)="resend($event)" novalidate [attr.aria-busy]="busy()">
      @if (!knownEmail) {
        <div class="field">
          <label for="email">Email address</label>
          <input #emailField id="email" class="input" type="email" autocomplete="email" maxlength="254" [value]="email()" (input)="email.set(emailField.value)" />
        </div>
      }

      @if (sent()) {
        <p class="status-text" role="status">If this address is waiting for verification, a new link is on its way.</p>
      }
      @if (formError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      <button class="btn btn-secondary btn-block" type="submit" [disabled]="busy()">
        {{ busy() ? 'Sending…' : 'Resend verification email' }}
      </button>
    </form>

    <div class="auth-actions">
      <a class="btn" routerLink="/signup">Use a different email</a>
      <a class="btn" routerLink="/login">Back to log in</a>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckEmail {
  private readonly accounts = inject(Accounts);

  protected readonly knownEmail: string | null =
    inject(DOCUMENT).defaultView?.history.state?.email ?? inject(Session).user()?.email ?? null;

  protected readonly email = signal(this.knownEmail ?? '');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected async resend(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const email = this.email().trim();

    this.sent.set(false);
    this.formError.set(email ? null : 'Enter your email address.');

    if (!email) return;

    this.busy.set(true);

    try {
      await this.accounts.resendVerification(email);
      this.sent.set(true);
    } catch (error) {
      const apiError = toApiError(error);

      this.formError.set(apiError.code === 'VALIDATION_FAILED' ? 'Enter a valid email address.' : commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
