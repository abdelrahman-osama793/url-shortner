import { ChangeDetectionStrategy, Component, inject, output, signal, viewChild } from '@angular/core';
import type { MeResponse } from '@shortlist/contracts';

import { Accounts } from '../../core/auth/accounts';
import { commonMessage, toApiError } from '../../core/http/api-error';

import { GoogleButton } from './google-button';
import { PasswordField } from './password-field';

// "Confirm it's you" before a sensitive action (recent authentication, T16). Offers the methods
// this account actually has: its password, its linked Google account, or both.
@Component({
  selector: 'app-confirm-identity',
  imports: [GoogleButton, PasswordField],
  template: `
    <div class="confirm" role="group" aria-labelledby="confirm-identity-title">
      <h3 id="confirm-identity-title">Confirm it's you</h3>
      <p class="muted">For your protection, this needs a recent confirmation.</p>

      @if (methods(); as account) {
        @if (account.signInMethods.password) {
          <form class="form-stack" (submit)="confirmPassword($event)" novalidate [attr.aria-busy]="busy()">
            <app-password-field fieldId="confirm-identity-password" label="Your password" autocomplete="current-password" [error]="error()" [(value)]="password" />
            <button class="btn btn-primary" type="submit" [disabled]="busy()">{{ busy() ? 'Checking…' : 'Confirm' }}</button>
          </form>
        }
        @if (account.signInMethods.google) {
          @if (account.signInMethods.password) {
            <div class="divider">or</div>
          }
          <app-google-button purpose="reauthenticate" (reauthenticated)="confirmed.emit()" />
        }
      } @else if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      } @else {
        <p class="muted" role="status">Loading…</p>
      }
    </div>
  `,
  styles: `
    .confirm {
      display: grid;
      gap: 12px;
      max-width: 380px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-surface);
      background: var(--paper);
    }

    .confirm p {
      font-size: 13px;
    }

    .divider {
      margin: 4px 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmIdentity {
  private readonly accounts = inject(Accounts);

  readonly confirmed = output<void>();

  protected readonly methods = signal<MeResponse | null>(null);
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  private readonly passwordField = viewChild(PasswordField);

  constructor() {
    this.loadMethods().catch(() => null);
  }

  private async loadMethods(): Promise<void> {
    try {
      this.methods.set(await this.accounts.summary());
    } catch (error) {
      this.error.set(commonMessage(toApiError(error)));
    }
  }

  protected async confirmPassword(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    if (!this.password()) {
      this.error.set('Enter your password.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    try {
      await this.accounts.reauthenticate(this.password());
      this.confirmed.emit();
    } catch (error) {
      this.error.set(commonMessage(toApiError(error)));
      this.password.set('');
      this.passwordField()?.focus();
    } finally {
      this.busy.set(false);
    }
  }
}
