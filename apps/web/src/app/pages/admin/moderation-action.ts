import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, input, output, signal, viewChild } from '@angular/core';

import { commonMessage, toApiError } from '../../core/http/api-error';
import { ConfirmIdentity } from '../auth/confirm-identity';

const REASON_MAX = 2000;

// One moderation change: a required reason (kept in the audit trail, never shown to the owner),
// an explicit confirm button, and recent authentication when the server asks for it. After
// "Confirm it's you" succeeds, the same change is sent again with the same reason.
@Component({
  selector: 'app-moderation-action',
  imports: [ConfirmIdentity],
  template: `
    <form class="action" [class.danger]="danger()" (submit)="submit($event)" novalidate [attr.aria-busy]="busy()" aria-labelledby="action-title">
      <h3 id="action-title">{{ heading() }}</h3>
      <p class="muted">{{ explanation() }}</p>

      <div class="field">
        <label for="action-reason">{{ reasonLabel() }}</label>
        <textarea
          #reasonField
          id="action-reason"
          class="input"
          rows="3"
          [attr.maxlength]="reasonMax"
          [value]="reason()"
          (input)="reason.set(reasonField.value); error.set(null)"
          [attr.aria-invalid]="error() && !reason().trim() ? 'true' : null"
          aria-describedby="action-reason-hint"
        ></textarea>
        <span id="action-reason-hint" class="field-hint">Kept in the audit trail with your name. Owners never see it.</span>
      </div>

      @if (needsConfirmation()) {
        <app-confirm-identity (confirmed)="retryAfterConfirmation()" />
      }

      @if (error(); as message) {
        <p class="form-error" role="alert">{{ message }}</p>
      }

      <div class="buttons">
        <button class="btn" [class.btn-danger]="danger()" [class.btn-primary]="!danger()" type="submit" [disabled]="busy() || needsConfirmation()">
          {{ busy() ? 'Saving…' : confirmLabel() }}
        </button>
        <button class="btn" type="button" (click)="cancelled.emit()">Cancel</button>
      </div>
    </form>
  `,
  styles: `
    .action {
      display: grid;
      gap: 12px;
      padding: 16px;
      border: 1px solid var(--line);
      border-radius: var(--radius-surface);
      background: var(--soft);
    }

    .action.danger {
      border-color: var(--error);
    }

    .action p {
      font-size: 13px;
    }

    textarea.input {
      resize: vertical;
      font-family: inherit;
    }

    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
  `,
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
