import { ChangeDetectionStrategy, Component, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { safeNext } from '../../../core/auth/guards';
import { Session } from '../../../core/auth/session';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { Icon } from '../../../shared/ui/icon/icon';

import { GoogleButton } from '../google-button/google-button';
import { PasswordField } from '../password-field/password-field';

// Password or Google sign-in. Wrong email and wrong password get the same message, so the form
// never reveals whether an account exists. Unverified accounts sign in to a restricted session
// (the workspace asks them to verify before creating links).
@Component({
  selector: 'app-login',
  imports: [RouterLink, Icon, GoogleButton, PasswordField],
  templateUrl: './login.html',
  styleUrl: './login.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  // ?next= from the workspace guard: where to go after signing in (workspace paths only).
  readonly next = input<string>();
  // ?expired=1 when a workspace request found the session gone.
  readonly expired = input<string>();
  // ?suspended=1 when the account was suspended while signed in.
  readonly suspended = input<string>();
  // ?closed=deactivated|deleted right after the person closed their account.
  readonly closed = input<string>();

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);

  private readonly passwordField = viewChild.required(PasswordField);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    if (!this.email().trim() || !this.password()) {
      this.formError.set('Enter your email address and password.');
      return;
    }

    this.busy.set(true);
    this.formError.set(null);

    try {
      await this.session.logIn(this.email().trim(), this.password());
      await this.enter();
    } catch (error) {
      const apiError = toApiError(error);

      this.formError.set(apiError.code === 'VALIDATION_FAILED' ? 'Enter a valid email address.' : commonMessage(apiError));
      this.password.set('');
      this.passwordField().focus();
    } finally {
      this.busy.set(false);
    }
  }

  protected async enter(): Promise<void> {
    await this.router.navigateByUrl(safeNext(this.next()));
  }
}
