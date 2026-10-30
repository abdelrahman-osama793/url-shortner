import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PASSWORD_MIN_LENGTH } from '@shortlist/contracts/constants';

import { Accounts } from '../../core/auth/accounts';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

import { GoogleButton } from './google-button';
import { PasswordField } from './password-field';

// Email sign-up does not sign in (api-contracts.md): it sends a verification link and moves to
// the check-your-inbox screen. The answer is the same whether or not the email is taken.
// Google sign-up creates the account and signs in straight away.
@Component({
  selector: 'app-signup',
  imports: [RouterLink, Icon, GoogleButton, PasswordField],
  template: `
    <h1>Create your account</h1>
    <p class="auth-intro">A little more control over everything you share.</p>

    <app-google-button text="signup_with" (signedIn)="enterWorkspace()" />

    <form class="form-stack" (submit)="submit($event)" novalidate [attr.aria-busy]="busy()">
      <div class="field">
        <label for="email">Email address</label>
        <input
          #emailField
          id="email"
          class="input"
          type="email"
          autocomplete="email"
          maxlength="254"
          [value]="email()"
          (input)="email.set(emailField.value); emailError.set(null)"
          [attr.aria-invalid]="emailError() ? 'true' : null"
          [attr.aria-describedby]="emailError() ? 'email-error' : null"
        />
        @if (emailError(); as message) {
          <p id="email-error" class="field-error" role="alert">{{ message }}</p>
        }
      </div>

      <app-password-field
        fieldId="password"
        autocomplete="new-password"
        [hint]="'At least ' + minLength + ' characters.'"
        [error]="passwordError()"
        [(value)]="password"
      />

      @if (formError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
        {{ busy() ? 'Creating account…' : 'Create account' }} <app-icon name="arrow-right" />
      </button>
    </form>

    <p class="auth-switch">Already have an account? <a routerLink="/login">Log in</a></p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Signup {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);

  protected readonly minLength = PASSWORD_MIN_LENGTH;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly emailError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const email = this.email().trim();

    this.emailError.set(email ? null : 'Enter your email address.');
    this.passwordError.set(this.password().length >= PASSWORD_MIN_LENGTH ? null : `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    this.formError.set(null);

    if (this.emailError() || this.passwordError()) return;

    this.busy.set(true);

    try {
      await this.accounts.register(email, this.password());
      // The address travels in navigation state, never in the URL.
      await this.router.navigate(['/signup/check-email'], { state: { email } });
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'VALIDATION_FAILED') {
        this.emailError.set(apiError.fieldMessage('email') && 'Enter a valid email address.');
        this.passwordError.set(apiError.fieldMessage('password'));
      } else {
        this.formError.set(commonMessage(apiError));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async enterWorkspace(): Promise<void> {
    await this.router.navigateByUrl('/app/links');
  }
}
