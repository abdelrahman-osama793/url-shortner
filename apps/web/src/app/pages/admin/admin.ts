import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { AdminLink, AdminReport, AuditEntry } from '@shortlist/contracts';

import { AdminApi, type AuditTarget, type ReportStatus } from '../../core/api/admin';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';
import { StatusBadge } from '../../shared/ui/status-badge';

import { ModerationAction } from './moderation-action';

type Action =
  | { kind: 'report'; status: ReportStatus }
  | { kind: 'block' }
  | { kind: 'unblock' }
  | { kind: 'suspend' }
  | { kind: 'reactivate' };

const STATUSES: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
];

const CATEGORY_LABELS: Record<string, string> = { phishing: 'Phishing', malware: 'Malware', spam: 'Spam', other: 'Something else' };

const ACTION_LABELS: Record<string, string> = {
  'report.open': 'Report reopened',
  'report.reviewing': 'Report marked as reviewing',
  'report.resolved': 'Report resolved',
  'report.dismissed': 'Report dismissed',
  'link.blocked': 'Link blocked',
  'link.unblocked': 'Link unblocked',
  'user.suspended': 'Account suspended',
  'user.reactivated': 'Account reactivated',
};

// Administration (UI_HANDOFF "Admin moderation"; T30 API). Reports are worked from a queue; a
// selected report shows its link with the owner and history. Changing a report's status and
// blocking its link are separate, explicit actions, each with a reason and a recent
// confirmation. The server enforces every rule; this page only reflects its answers.
@Component({
  selector: 'app-admin',
  imports: [DatePipe, Icon, StatusBadge, ModerationAction],
  templateUrl: './admin.html',
  styleUrl: './admin.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPage {
  private readonly api = inject(AdminApi);

  protected readonly statuses = STATUSES;
  protected readonly categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category;
  protected readonly actionLabel = (action: string) => ACTION_LABELS[action] ?? action;

  // Queue
  protected readonly status = signal<ReportStatus>('open');
  protected readonly reports = signal<AdminReport[]>([]);
  protected readonly nextCursor = signal<string | null>(null);
  protected readonly queueLoading = signal(true);
  protected readonly queueError = signal<string | null>(null);

  // Selection: a report and its link, or a link looked up by code.
  protected readonly lookupCode = signal('');
  protected readonly report = signal<AdminReport | null>(null);
  protected readonly link = signal<AdminLink | null>(null);
  protected readonly detailLoading = signal(false);
  protected readonly detailError = signal<string | null>(null);
  protected readonly history = signal<AuditEntry[]>([]);
  protected readonly action = signal<Action | null>(null);
  protected readonly notice = signal<string | null>(null);

  // Recent activity across everything
  protected readonly activity = signal<AuditEntry[]>([]);
  protected readonly activityCursor = signal<string | null>(null);
  protected readonly activityError = signal<string | null>(null);

  protected readonly reportActions = computed<{ status: ReportStatus; label: string }[]>(() => {
    switch (this.report()?.status) {
      case 'open':
        return [{ status: 'reviewing', label: 'Mark as reviewing' }, { status: 'resolved', label: 'Resolve' }, { status: 'dismissed', label: 'Dismiss' }];
      case 'reviewing':
        return [{ status: 'resolved', label: 'Resolve' }, { status: 'dismissed', label: 'Dismiss' }, { status: 'open', label: 'Back to open' }];
      case 'resolved':
      case 'dismissed':
        return [{ status: 'open', label: 'Reopen' }];
      default:
        return [];
    }
  });

  constructor() {
    this.loadQueue().catch(() => null);
    this.loadActivity().catch(() => null);
  }

  // ----- Queue ---------------------------------------------------------------------------------

  protected async chooseStatus(status: ReportStatus): Promise<void> {
    this.status.set(status);
    await this.loadQueue();
  }

  protected async loadQueue(append = false): Promise<void> {
    this.queueLoading.set(true);
    this.queueError.set(null);

    try {
      const page = await this.api.reports(this.status(), append ? this.nextCursor() : null);

      this.reports.update((items) => (append ? [...items, ...page.items] : page.items));
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.queueError.set(commonMessage(toApiError(error)));
    } finally {
      this.queueLoading.set(false);
    }
  }

  // ----- Selection -----------------------------------------------------------------------------

  protected async selectReport(report: AdminReport): Promise<void> {
    this.report.set(report);
    await this.openLink(report.code);
  }

  protected async lookUp(event: Event): Promise<void> {
    event.preventDefault();

    const code = this.lookupCode().trim().replace(/^.*\/r\//, '');

    if (!code) return;

    this.report.set(null);
    await this.openLink(code);
  }

  protected close(): void {
    this.report.set(null);
    this.link.set(null);
    this.detailError.set(null);
    this.action.set(null);
  }

  private async openLink(code: string): Promise<void> {
    this.link.set(null);
    this.history.set([]);
    this.action.set(null);
    this.notice.set(null);
    this.detailError.set(null);
    this.detailLoading.set(true);

    try {
      this.link.set(await this.api.link(code));
      await this.loadHistory();
    } catch (error) {
      const apiError = toApiError(error);

      this.detailError.set(apiError.status === 404 ? `No link has the code "${code}". Codes are case-sensitive.` : commonMessage(apiError));
    } finally {
      this.detailLoading.set(false);
    }
  }

  // Everything recorded about this report, its link and the link's owner, newest first.
  private async loadHistory(): Promise<void> {
    const link = this.link();
    const targets: AuditTarget[] = [];

    if (link) targets.push({ targetType: 'link', targetId: link.id });
    if (link?.ownerId) targets.push({ targetType: 'user', targetId: link.ownerId });
    if (this.report()) targets.push({ targetType: 'report', targetId: this.report()!.id });

    const pages = await Promise.all(targets.map((target) => this.api.audit(target)));

    this.history.set(pages.flatMap((page) => page.items).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }

  // ----- Actions -------------------------------------------------------------------------------

  protected start(action: Action): void {
    this.notice.set(null);
    this.action.set(action);
  }

  // Each run function performs one change and refreshes what it affects. Errors propagate to the
  // action form, which shows them (and asks for confirmation when the server requires it).
  protected readonly runReportStatus = async (reason: string): Promise<void> => {
    const current = this.action();
    const report = this.report();

    if (current?.kind !== 'report' || !report) return;

    const updated = await this.api.setReportStatus(report.id, current.status, reason);

    this.report.set(updated);
    // It no longer belongs in this queue view.
    if (updated.status !== this.status()) this.reports.update((items) => items.filter((item) => item.id !== updated.id));
    await this.refreshLink(`Report ${updated.status === 'open' ? 'reopened' : `marked as ${updated.status}`}. The link was not changed.`);
  };

  protected readonly runLinkBlock = async (reason: string): Promise<void> => {
    const link = this.link();
    const blocked = this.action()?.kind === 'block';

    if (!link) return;

    try {
      this.link.set(await this.api.setLinkBlocked(link, blocked, reason));
    } catch (error) {
      // Changed by its owner or another admin since it was loaded: show the latest, then let the
      // admin decide again.
      if (toApiError(error).code === 'PRECONDITION_FAILED') await this.refreshLink(null);
      throw error;
    }

    await this.refreshLink(blocked ? 'Link blocked. Visitors now see an unavailable page.' : 'Link unblocked. It works again unless the owner disabled it, it expired or the owner is suspended.');
  };

  protected readonly runOwnerSuspension = async (reason: string): Promise<void> => {
    const ownerId = this.link()?.ownerId;
    const suspended = this.action()?.kind === 'suspend';

    if (!ownerId) return;

    await this.api.setUserSuspended(ownerId, suspended, reason);
    await this.refreshLink(suspended ? 'Account suspended. Its links stop working and it is signed out everywhere.' : 'Account reactivated. Its links work again, except those blocked individually.');
  };

  protected finishAction(): void {
    this.action.set(null);
    this.loadActivity().catch(() => null);
  }

  // Never throws: the change itself already succeeded, so a failed reload must not look like a
  // failed change.
  private async refreshLink(notice: string | null): Promise<void> {
    const code = this.link()?.code;

    try {
      if (code) this.link.set(await this.api.link(code));
      await this.loadHistory();
      this.notice.set(notice);
    } catch {
      this.notice.set(`${notice ?? 'Saved.'} The latest details could not be loaded; reload the page to see them.`);
    }
  }

  // ----- Recent activity -----------------------------------------------------------------------

  protected async loadActivity(append = false): Promise<void> {
    this.activityError.set(null);

    try {
      const page = await this.api.audit(null, append ? this.activityCursor() : null);

      this.activity.update((items) => (append ? [...items, ...page.items] : page.items));
      this.activityCursor.set(page.nextCursor);
    } catch (error) {
      this.activityError.set(commonMessage(toApiError(error)));
    }
  }
}
