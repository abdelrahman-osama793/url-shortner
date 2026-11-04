import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, signal, viewChild } from '@angular/core';

import { commonMessage, toApiError } from '../../../core/http/api-error';
import { ConfirmIdentity } from '../../auth/confirm-identity/confirm-identity';

const REASON_MAX = 2000;

// One moderation change: a required reason (kept in the audit trail, never shown to the owner),
// an explicit confirm button, and recent authentication when the server asks for it. After
// "Confirm it's you" succeeds, the same change is sent again with the same reason.
@Component({
  selector: 'app-moderation-action',
  imports: [ConfirmIdentity],
  templateUrl: './moderation-action.html',
  styleUrl: './moderation-action.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModerationAction {
  readonly heading = input.required<string>();
  readonly explanation = input('');
  readonly reasonLabel = input('Reason');
  readonly confirmLabel = input.required<string>();
  readonly danger = input(false);
  // Performs the change with the given reason; errors are shown here.
  readonly run = input.required<(reason: string) => Promise<void>>();

  readonly done = output<void>();
  readonly cancelled = output<void>();

  protected readonly reasonMax = REASON_MAX;
  protected readonly reason = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly needsConfirmation = signal(false);

  private readonly reasonField = viewChild.required<ElementRef<HTMLTextAreaElement>>('reasonField');

  constructor() {
    afterNextRender(() => this.reasonField().nativeElement.focus());
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    await this.perform();
  }

  protected async retryAfterConfirmation(): Promise<void> {
    this.needsConfirmation.set(false);
    await this.perform();
  }

  private async perform(): Promise<void> {
    if (this.busy()) return;

    const reason = this.reason().trim();

    if (!reason) {
      this.error.set('Give a reason. It is kept in the audit trail.');
      this.reasonField().nativeElement.focus();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    try {
      await this.run()(reason);
      this.done.emit();
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'REAUTHENTICATION_REQUIRED') this.needsConfirmation.set(true);
      else this.error.set(commonMessage(apiError));
    } finally {
      this.busy.set(false);
    }
  }
}
