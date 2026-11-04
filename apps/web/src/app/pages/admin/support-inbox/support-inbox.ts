import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { AdminSupportMessage } from '@shortlist/contracts';

import { SupportApi, type SupportStatus } from '../../../core/api/support';
import { commonMessage, toApiError } from '../../../core/http/api-error';

const TOPIC_LABELS: Record<AdminSupportMessage['topic'], string> = {
  account: 'Account or sign-in',
  links: 'Links or analytics',
  privacy: 'Privacy or data',
  other: 'Something else',
};

// Admin support inbox (T44): messages from the Contact page, oldest first. Replies happen by
// email outside the app; closing a message only takes it out of the open list.
@Component({
  selector: 'app-support-inbox',
  templateUrl: './support-inbox.html',
  styleUrl: './support-inbox.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SupportInbox {
  private readonly support = inject(SupportApi);

  protected readonly topicLabels = TOPIC_LABELS;
  protected readonly status = signal<SupportStatus>('open');
  protected readonly messages = signal<AdminSupportMessage[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected async show(status: SupportStatus): Promise<void> {
    this.status.set(status);
    await this.load();
  }

  protected async load(more = false): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const page = await this.support.inbox(this.status(), more ? this.nextCursor() : null);

      this.messages.set(more ? [...this.messages(), ...page.items] : page.items);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.error.set(commonMessage(toApiError(error)));
    } finally {
      this.loading.set(false);
    }
  }

  protected async toggle(message: AdminSupportMessage): Promise<void> {
    this.busyId.set(message.id);
    this.error.set(null);

    try {
      await this.support.setStatus(message.id, message.status === 'open' ? 'closed' : 'open');
      this.messages.set(this.messages().filter((item) => item.id !== message.id));
    } catch (error) {
      this.error.set(commonMessage(toApiError(error)));
    } finally {
      this.busyId.set(null);
    }
  }

  protected date(iso: string): string {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  }
}
