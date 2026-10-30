import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../core/auth/accounts';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

// Requests a reset link. The confirmation is the same for every address, so it never reveals
// whether an account exists.
@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink, Icon],
  template: `
    @if (sent()) {
      <div class="status-mark"><app-icon name="mail-check" /></div>
      <h1>Check your inbox</h1>
      <p class="auth-intro">
        If an account exists for <strong>{{ email().trim() }}</strong>, it will receive a password reset link.
        The link works once and expires after 30 minutes.
      </p>
      <div class="auth-actions">
        <a class="btn btn-primary" routerLink="/login">Back to log in</a>
        <button class="btn" type="button" (click)="sent.set(false)">Use a different email</button>
      </div>
    } @else {
      <h1>Forgot your password?</h1>
      <p class="auth-intro">Enter your email and we'll send you a link to choose a new one.</p>

      <form class="form-stack" (submit)="submit($event)" novalidate [attr.aria-busy]="busy()">
        <div class="field">
          <label for="email">Email address</label>
          <input #emailField id="email" class="input" type="email" autocomplete="email" maxlength="254" [value]="email()" (input)="email.set(emailField.value)" />
        </div>

        @if (formError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }

        <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
          {{ busy() ? 'Sending…' : 'Send reset link' }} <app-icon name="arrow-right" />
        </button>
      </form>

      <p class="auth-switch"><a routerLink="/login">Back to log in</a></p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ForgotPassword {
  private readonly accounts = inject(Accounts);

  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const email = this.email().trim();

    this.formError.set(email ? null : 'Enter your email address.');

    if (!email) return;

    this.busy.set(true);

    try {
      await this.accounts.forgotPassword(email);
      this.sent.set(true);
    } catch (error) {
      const apiError = toApiError(error);

      this.formError.set(apiError.code === 'VALIDATION_FAILED' ? 'Enter a valid email address.' : commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
