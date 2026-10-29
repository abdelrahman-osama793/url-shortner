import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { EffectiveStatus } from '@shortlist/contracts';

// Effective link status as text plus colour (UI_HANDOFF: status is expressed in text, and
// disabled, expired, blocked and owner-suspended stay distinct).
const STATUS_LABELS: Record<EffectiveStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  expired: 'Expired',
  blocked: 'Blocked',
  ownerSuspended: 'Owner suspended',
};

@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [attr.data-status]="status()">{{ label() }}</span>`,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      white-space: nowrap;
      background: var(--accent-soft);
      color: var(--accent);
    }

    .badge::before {
      content: '';
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
    }

    .badge[data-status='disabled'] {
      background: var(--soft);
      color: var(--muted);
    }

    .badge[data-status='expired'] {
      background: var(--warn-soft);
      color: var(--warn);
    }

    .badge[data-status='blocked'],
    .badge[data-status='ownerSuspended'] {
      background: var(--error-soft);
      color: var(--error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly status = input.required<EffectiveStatus>();

  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
