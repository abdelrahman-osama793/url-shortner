import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../../core/auth/accounts';
import { Session } from '../../../core/auth/session';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { Icon } from '../../../shared/ui/icon/icon';

// After sign-up, or when a verification link expired: explains the next step and resends the
// link. The address comes from sign-up's navigation state or the signed-in user; otherwise the
// visitor types it. The answer never says whether the address has an account.
@Component({
  selector: 'app-check-email',
  imports: [RouterLink, Icon],
  templateUrl: './check-email.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckEmail {
  private readonly accounts = inject(Accounts);

  protected readonly knownEmail: string | null =
    inject(DOCUMENT).defaultView?.history.state?.email ?? inject(Session).user()?.email ?? null;

  protected readonly email = signal(this.knownEmail ?? '');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly formError = signal<string | null>(null);

  protected async resend(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const email = this.email().trim();

    this.sent.set(false);
    this.formError.set(email ? null : 'Enter your email address.');

    if (!email) return;

    this.busy.set(true);

    try {
      await this.accounts.resendVerification(email);
      this.sent.set(true);
    } catch (error) {
      const apiError = toApiError(error);

      this.formError.set(apiError.code === 'VALIDATION_FAILED' ? 'Enter a valid email address.' : commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
