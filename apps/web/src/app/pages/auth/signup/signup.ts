import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PASSWORD_MIN_LENGTH } from '@shortlist/contracts/constants';

import { Accounts } from '../../../core/auth/accounts';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { Icon } from '../../../shared/ui/icon/icon';

import { GoogleButton } from '../google-button/google-button';
import { PasswordField } from '../password-field/password-field';

// Email sign-up does not sign in (api-contracts.md): it sends a verification link and moves to
// the check-your-inbox screen. The answer is the same whether or not the email is taken.
// Google sign-up creates the account and signs in straight away.
@Component({
  selector: 'app-signup',
  imports: [RouterLink, Icon, GoogleButton, PasswordField],
  templateUrl: './signup.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Signup {
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);

  protected readonly minLength = PASSWORD_MIN_LENGTH;

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly confirmation = signal('');
  protected readonly busy = signal(false);
  protected readonly emailError = signal<string | null>(null);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly confirmError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const email = this.email().trim();

    this.emailError.set(email ? null : 'Enter your email address.');
    this.passwordError.set(this.password().length >= PASSWORD_MIN_LENGTH ? null : `Use at least ${PASSWORD_MIN_LENGTH} characters.`);
    this.confirmError.set(this.password() === this.confirmation() ? null : "The passwords don't match.");
    this.formError.set(null);

    if (this.emailError() || this.passwordError() || this.confirmError()) return;

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
