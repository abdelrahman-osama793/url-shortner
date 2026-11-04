import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { Accounts } from '../../../core/auth/accounts';
import { Session } from '../../../core/auth/session';
import { commonMessage, toApiError } from '../../../core/http/api-error';
import { ConfirmIdentity } from '../../auth/confirm-identity/confirm-identity';

type Action = 'deactivate' | 'delete';

// "Close your account" on the account page (T45). Deactivating pauses the account and can be
// undone by signing in; deleting is permanent and needs the account email typed. Both need a
// recent sign-in: if it has lapsed, the person confirms it's them and the action is retried.
@Component({
  selector: 'app-close-account',
  imports: [ConfirmIdentity],
  templateUrl: './close-account.html',
  styleUrl: './close-account.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CloseAccount {
  private readonly accounts = inject(Accounts);
  private readonly session = inject(Session);
  private readonly router = inject(Router);

  readonly email = input.required<string>();

  protected readonly open = signal<Action | null>(null);
  protected readonly needsConfirmation = signal(false);
  protected readonly typedEmail = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected show(action: Action | null): void {
    this.open.set(action);
    this.needsConfirmation.set(false);
    this.typedEmail.set('');
    this.error.set(null);
  }

  protected async run(event?: Event): Promise<void> {
    event?.preventDefault();

    const action = this.open();

    if (!action || this.busy()) return;

    if (action === 'delete' && this.typedEmail().trim().toLowerCase() !== this.email().toLowerCase()) {
      this.error.set('Type your account email exactly to confirm.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    try {
      if (action === 'deactivate') await this.accounts.deactivate();
      else await this.accounts.deleteAccount(this.typedEmail().trim());

      // The server has ended the session; forget it here and leave the workspace.
      this.session.forget();
      await this.router.navigate(['/login'], { queryParams: { closed: action === 'deactivate' ? 'deactivated' : 'deleted' } });
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'REAUTHENTICATION_REQUIRED') this.needsConfirmation.set(true);
      else this.error.set(apiError.fieldMessage('email') ?? commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }

  protected async retryAfterConfirmation(): Promise<void> {
    this.needsConfirmation.set(false);
    await this.run();
  }
}
