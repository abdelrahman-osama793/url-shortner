import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PASSWORD_MIN_LENGTH } from '@shortlist/contracts/constants';

import { Accounts } from '../../core/auth/accounts';
import { takeFragmentToken } from '../../core/auth/one-time-token';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

import { PasswordField } from './password-field';

type State = 'form' | 'done' | 'expired' | 'used' | 'invalid';

// The page a reset link opens. A successful reset signs the account out everywhere, including
// this browser, so the success screen leads back to Log in.
@Component({
  selector: 'app-reset-password',
  imports: [RouterLink, Icon, PasswordField],
  template: `
    @switch (state()) {
      @case ('form') {
        <h1>Choose a new password</h1>
        <p class="auth-intro">You'll be signed out on every device and can then log in with it.</p>

        <form class="form-stack" (submit)="submit($event)" novalidate [attr.aria-busy]="busy()">
          <app-password-field
            fieldId="new-password"
            label="New password"
            autocomplete="new-password"
            [hint]="'At least ' + minLength + ' characters.'"
            [error]="passwordError()"
            [(value)]="password"
          />
          <app-password-field
            fieldId="confirm-password"
            label="Confirm password"
            autocomplete="new-password"
            [error]="confirmError()"
            [(value)]="confirmation"
          />

          @if (formError(); as message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }

          <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
            {{ busy() ? 'Saving…' : 'Reset password' }} <app-icon name="arrow-right" />
          </button>
        </form>
      }
      @case ('done') {
        <div class="status-mark"><app-icon name="check" /></div>
        <h1>Password reset complete</h1>
        <p class="auth-intro">You've been signed out everywhere. Log in with your new password.</p>
        <a class="btn btn-primary btn-block" routerLink="/login">Back to log in <app-icon name="arrow-right" /></a>
      }
      @case ('expired') {
        <div class="status-mark warn"><app-icon name="clock" /></div>
        <h1>This link has expired</h1>
        <p class="auth-intro">Reset links last 30 minutes. Ask for a new one.</p>
        <a class="btn btn-primary btn-block" routerLink="/forgot-password">Request a new link</a>
      }
      @case ('used') {
        <div class="status-mark warn"><app-icon name="info" /></div>
        <h1>This link was already used</h1>
        <p class="auth-intro">Each reset link works once. If you didn't finish, ask for a new one.</p>
        <a class="btn btn-primary btn-block" routerLink="/forgot-password">Request a new link</a>
      }
      @default {
        <div class="status-mark warn"><app-icon name="x" /></div>
        <h1>This link isn't valid</h1>
        <p class="auth-intro">Make sure you opened the whole link from the email, or ask for a new one.</p>
        <a class="btn btn-primary btn-block" routerLink="/forgot-password">Request a new link</a>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResetPassword {
  private readonly accounts = inject(Accounts);
  private readonly session = inject(Session);

  private readonly token = takeFragmentToken();

  protected readonly minLength = PASSWORD_MIN_LENGTH;

  protected readonly state = signal<State>(this.token ? 'form' : 'invalid');
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (!this.token || this.busy()) return;

    this.passwordError.set(this.password().length >= PASSWORD_MIN_LENGTH ? null : `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    this.confirmError.set(this.password() === this.confirmation() ? null : "The passwords don't match.");
    this.formError.set(null);

    if (this.passwordError() || this.confirmError()) return;

    this.busy.set(true);

    try {
      await this.accounts.resetPassword(this.token, this.password());
      // Every session of the account was revoked, possibly including this browser's.
      await this.session.reload().catch(() => null);
      this.state.set('done');
    } catch (error) {
      const apiError = toApiError(error);
      const tokenStates: Record<string, State> = { TOKEN_EXPIRED: 'expired', TOKEN_USED: 'used', TOKEN_INVALID: 'invalid' };

      if (tokenStates[apiError.code]) this.state.set(tokenStates[apiError.code]);
      else if (apiError.code === 'VALIDATION_FAILED') this.passwordError.set(apiError.fieldMessage('newPassword') ?? 'Choose a different password.');
      else this.formError.set(commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
