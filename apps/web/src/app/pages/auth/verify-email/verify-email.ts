import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Accounts } from '../../../core/auth/accounts';
import { takeFragmentToken } from '../../../core/auth/one-time-token';
import { Session } from '../../../core/auth/session';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { Icon } from '../../../shared/ui/icon/icon';

type State = 'ready' | 'verified' | 'expired' | 'used' | 'invalid';

// The page an email verification link opens. The token is used only when the person presses
// Confirm, so link scanners that open pages cannot use it up.
@Component({
  selector: 'app-verify-email',
  imports: [RouterLink, Icon],
  templateUrl: './verify-email.html',
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
