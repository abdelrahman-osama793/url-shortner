import { ChangeDetectionStrategy, Component, inject, input, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { safeNext } from '../../core/auth/guards';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

import { GoogleButton } from './google-button';
import { PasswordField } from './password-field';

// Password or Google sign-in. Wrong email and wrong password get the same message, so the form
// never reveals whether an account exists. Unverified accounts sign in to a restricted session
// (the workspace asks them to verify before creating links).
@Component({
  selector: 'app-login',
  imports: [RouterLink, Icon, GoogleButton, PasswordField],
  template: `
    <h1>Welcome back.</h1>
    <p class="auth-intro">Log in to pick up where you left off.</p>

    @if (next()) {
      <p class="note">Please log in to continue.</p>
    }

    <app-google-button (signedIn)="enter()" />

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
          (input)="email.set(emailField.value)"
        />
      </div>

      <app-password-field fieldId="password" autocomplete="current-password" [(value)]="password" />

      <div class="form-meta"><a routerLink="/forgot-password">Forgot password?</a></div>

      @if (formError(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      <button class="btn btn-primary btn-block" type="submit" [disabled]="busy()">
        {{ busy() ? 'Logging in…' : 'Log in' }} <app-icon name="arrow-right" />
      </button>
    </form>

    <p class="auth-switch">New to Shortlist? <a routerLink="/signup">Sign up</a></p>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  // ?next= from the workspace guard: where to go after signing in (workspace paths only).
  readonly next = input<string>();

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
