import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SUPPORT_MESSAGE_MAX_LENGTH } from '@shortlist/contracts/constants';

import { SupportApi } from '../../core/api/support';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { OPERATOR } from '../../core/operator';
import { Icon } from '../../shared/ui/icon/icon';

const TOPICS = [
  { value: 'account', label: 'My account or signing in' },
  { value: 'links', label: 'My links or analytics' },
  { value: 'privacy', label: 'Privacy or my data' },
  { value: 'other', label: 'Something else' },
] as const;

type Topic = (typeof TOPICS)[number]['value'];

// Contact (T44): abuse goes to the report form, everything else to the support inbox that
// administrators read. Signed-in people are answered at their account email.
@Component({
  selector: 'app-contact',
  imports: [RouterLink, Icon],
  templateUrl: './contact.html',
  styleUrl: './contact.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPage {
  private readonly support = inject(SupportApi);
  private readonly injector = inject(Injector);

  protected readonly session = inject(Session);
  protected readonly operator = OPERATOR;
  protected readonly topics = TOPICS;
  protected readonly maxMessage = SUPPORT_MESSAGE_MAX_LENGTH;

  protected readonly topic = signal<Topic>('account');
  protected readonly message = signal('');
  protected readonly email = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly errors = signal<{ message?: string; email?: string }>({});
  protected readonly formError = signal<string | null>(null);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('doneHeading');

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const signedIn = this.session.signedIn();
    const message = this.message().trim();
    const email = this.email().trim();
    const errors = {
      message: !message ? 'Write your message.' : message.length > SUPPORT_MESSAGE_MAX_LENGTH ? `Use at most ${SUPPORT_MESSAGE_MAX_LENGTH} characters.` : undefined,
      email: !signedIn && !email ? 'Enter the email address we should reply to.' : undefined,
    };

    this.errors.set(errors);
    this.formError.set(null);

    if (errors.message || errors.email) return;

    this.busy.set(true);

    try {
      await this.support.send({ topic: this.topic(), message, ...(signedIn ? {} : { email }) });
      this.sent.set(true);
      afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'VALIDATION_FAILED') {
        this.errors.set({ message: apiError.fieldMessage('message') ?? undefined, email: apiError.fieldMessage('email') ?? undefined });
        if (!apiError.fieldMessage('message') && !apiError.fieldMessage('email')) this.formError.set(apiError.message);
      } else {
        this.formError.set(commonMessage(apiError));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected writeAnother(): void {
    this.message.set('');
    this.sent.set(false);
  }
}
