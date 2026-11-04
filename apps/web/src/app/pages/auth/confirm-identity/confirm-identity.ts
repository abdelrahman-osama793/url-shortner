import { ChangeDetectionStrategy, Component, inject, output, signal, viewChild } from '@angular/core';
import type { MeResponse } from '@shortlist/contracts';

import { Accounts } from '../../../core/auth/accounts';
import { commonMessage, toApiError } from '../../../core/http/api-error';

import { GoogleButton } from '../google-button/google-button';
import { PasswordField } from '../password-field/password-field';

// "Confirm it's you" before a sensitive action (recent authentication, T16). Offers the methods
// this account actually has: its password, its linked Google account, or both.
@Component({
  selector: 'app-confirm-identity',
  imports: [GoogleButton, PasswordField],
  templateUrl: './confirm-identity.html',
  styleUrl: './confirm-identity.css',
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
