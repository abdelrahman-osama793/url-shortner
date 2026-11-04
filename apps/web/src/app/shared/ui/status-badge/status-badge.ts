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
  ownerDeactivated: 'Owner deactivated',
};

@Component({
  selector: 'app-status-badge',
  styleUrl: './status-badge.css',
  templateUrl: './status-badge.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadge {
  readonly status = input.required<EffectiveStatus>();

  protected readonly label = computed(() => STATUS_LABELS[this.status()]);
}
