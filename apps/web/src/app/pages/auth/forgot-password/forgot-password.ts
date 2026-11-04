import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../../core/auth/accounts';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { Icon } from '../../../shared/ui/icon/icon';

// Requests a reset link. The confirmation is the same for every address, so it never reveals
// whether an account exists.
@Component({
  selector: 'app-forgot-password',
  imports: [RouterLink, Icon],
  templateUrl: './forgot-password.html',
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
