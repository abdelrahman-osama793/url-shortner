import { DOCUMENT, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import type { Link } from '@shortlist/contracts';

import { Links } from '../../core/api/links';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';
import { StatusBadge } from '../../shared/ui/status-badge';

import { LinkEditor } from './link-editor';

type Editor = { mode: 'create' } | { mode: 'edit'; link: Link };

// The owner's links, newest first, from the real API: create, edit, copy, disable and enable.
// Only active and disabled links can be toggled. A disabled link is the owner's choice; blocked
// (moderation), owner-suspended and expired links are not, and enabling never lifts them.
@Component({
  selector: 'app-links',
  imports: [DatePipe, Icon, StatusBadge, LinkEditor],
  templateUrl: './links.html',
  styleUrl: './links.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinksPage {
  private readonly links = inject(Links);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly session = inject(Session);

  protected readonly items = signal<Link[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly loading = signal<'first' | 'more' | null>('first');
  protected readonly loadError = signal<string | null>(null);
  protected readonly editor = signal<Editor | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly rowMessage = signal<{ id: string; text: string } | null>(null);
  protected readonly copiedId = signal<string | null>(null);
  // Read out by screen readers after an action that does not move focus.
  protected readonly announcement = signal('');

  protected readonly canCreate = computed(() => this.session.user()?.emailVerified === true);
  protected readonly editingLink = computed(() => {
    const editor = this.editor();

    return editor?.mode === 'edit' ? editor.link : null;
  });

  constructor() {
    this.load().catch(() => null);
  }

  protected async load(): Promise<void> {
    this.loading.set('first');
    this.loadError.set(null);

    try {
      const page = await this.links.list();

      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.loadError.set(commonMessage(toApiError(error)));
    } finally {
      this.loading.set(null);
    }
  }

  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();

    if (!cursor || this.loading()) return;

    this.loading.set('more');
    this.loadError.set(null);

    try {
      const page = await this.links.list(cursor);
      const known = new Set(this.items().map((link) => link.id));

      // A link created meanwhile can shift pages; never show one twice.
      this.items.update((items) => [...items, ...page.items.filter((link) => !known.has(link.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.loadError.set(commonMessage(toApiError(error)));
    } finally {
      this.loading.set(null);
    }
  }

  protected openCreate(): void {
    this.editor.set({ mode: 'create' });
  }

  protected openEdit(link: Link): void {
    this.editor.set({ mode: 'edit', link });
    this.rowMessage.set(null);
  }

  protected closeEditor(): void {
    const editor = this.editor();

    this.editor.set(null);
    this.focusAfterRender(editor?.mode === 'edit' ? `edit-${editor.link.id}` : 'create-link');
  }

  protected onSaved(link: Link): void {
    const created = this.editor()?.mode === 'create';

    if (created) this.items.update((items) => [link, ...items]);
    else this.replace(link);

    this.editor.set(null);
    this.announcement.set(created ? `Created ${link.shortUrl}.` : 'Changes saved.');
    this.focusAfterRender(created ? `link-${link.id}` : `edit-${link.id}`);
  }

  protected async toggle(link: Link): Promise<void> {
    if (this.busyId()) return;

    const enable = link.effectiveStatus === 'disabled';

    this.busyId.set(link.id);
    this.rowMessage.set(null);

    try {
      const updated = await this.links.update(link, { enabled: enable });

      this.replace(updated);
      this.announcement.set(enable ? 'Link enabled.' : 'Link disabled. Visits now see an unavailable page.');
    } catch (error) {
      await this.showRowError(link, error);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async copy(link: Link): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(link.shortUrl);
      this.copiedId.set(link.id);
      this.announcement.set('Link copied to the clipboard.');
    } catch {
      this.rowMessage.set({ id: link.id, text: `Copying isn't available here. Select the link and copy it: ${link.shortUrl}` });
    }
  }

  private async showRowError(link: Link, error: unknown): Promise<void> {
    const apiError = toApiError(error);

    if (apiError.code !== 'PRECONDITION_FAILED') {
      this.rowMessage.set({ id: link.id, text: commonMessage(apiError) });
      return;
    }

    // Changed elsewhere: show the latest version rather than acting on an old one.
    try {
      this.replace(await this.links.get(link.id));
      this.rowMessage.set({ id: link.id, text: 'This link was changed somewhere else. The latest version is shown; try again if you still want to.' });
    } catch (reloadError) {
      this.rowMessage.set({ id: link.id, text: commonMessage(toApiError(reloadError)) });
    }
  }

  private replace(link: Link): void {
    this.items.update((items) => items.map((item) => (item.id === link.id ? link : item)));
  }

  private focusAfterRender(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
