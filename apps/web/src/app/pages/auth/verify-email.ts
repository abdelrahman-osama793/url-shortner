import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../core/auth/accounts';
import { takeFragmentToken } from '../../core/auth/one-time-token';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

type State = 'ready' | 'verified' | 'expired' | 'used' | 'invalid';

// The page an email verification link opens. The token is used only when the person presses
// Confirm, so link scanners that open pages cannot use it up.
@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, Icon],
  template: `
    @switch (state()) {
      @case ('ready') {
        <div class="mark"><app-icon name="mail-check" /></div>
        <h1>Confirm your email</h1>
        <p class="auth-intro">One click and your account is ready to create links.</p>
        @if (formError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <button class="btn btn-primary btn-block" type="button" (click)="confirm()" [disabled]="busy()">
          {{ busy() ? 'Confirming…' : 'Confirm email address' }} <app-icon name="arrow-right" />
        </button>
      }
      @case ('verified') {
        <div class="mark"><app-icon name="badge-check" /></div>
        <h1>Email verified</h1>
        @if (session.signedIn()) {
          <p class="auth-intro">You're all set. Create your first link.</p>
          <a class="btn btn-primary btn-block" routerLink="/app/links">Go to your links <app-icon name="arrow-right" /></a>
        } @else {
          <p class="auth-intro">Your next step is to log in and create your first link.</p>
          <a class="btn btn-primary btn-block" routerLink="/login">Continue to log in <app-icon name="arrow-right" /></a>
        }
      }
      @case ('expired') {
        <div class="mark warn"><app-icon name="clock" /></div>
        <h1>This link has expired</h1>
        <p class="auth-intro">Verification links last 24 hours. Ask for a new one below.</p>
        <a class="btn btn-primary btn-block" routerLink="/signup/check-email">Send a new link</a>
      }
      @case ('used') {
        <div class="mark warn"><app-icon name="info" /></div>
        <h1>This link was already used</h1>
        <p class="auth-intro">If you verified your email with it, you can log in.</p>
        <a class="btn btn-primary btn-block" routerLink="/login">Log in</a>
      }
      @default {
        <div class="mark warn"><app-icon name="x" /></div>
        <h1>This link isn't valid</h1>
        <p class="auth-intro">Make sure you opened the whole link from the email, or ask for a new one.</p>
        <a class="btn btn-primary btn-block" routerLink="/signup/check-email">Send a new link</a>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VerifyEmail {
  private readonly accounts = inject(Accounts);
  protected readonly session = inject(Session);

  private readonly token = takeFragmentToken();

  protected readonly state = signal<State>(this.token ? 'ready' : 'invalid');
  protected readonly busy = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected async confirm(): Promise<void> {
    if (!this.token || this.busy()) return;

    this.busy.set(true);
    this.formError.set(null);

    try {
      await this.accounts.verifyEmail(this.token);
      // A signed-in (restricted) user is now verified; refresh what the workspace shows.
      await this.session.reload().catch(() => null);
      this.state.set('verified');
    } catch (error) {
      const apiError = toApiError(error);
      const tokenStates: Record<string, State> = { TOKEN_EXPIRED: 'expired', TOKEN_USED: 'used', TOKEN_INVALID: 'invalid' };

      if (tokenStates[apiError.code]) this.state.set(tokenStates[apiError.code]);
      else this.formError.set(commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
