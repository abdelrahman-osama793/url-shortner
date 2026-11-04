// Effective status, highest priority first (api-contracts.md, "Create — registered user"):
//   blocked → ownerSuspended → ownerDeactivated → disabled → expired → active
// Owner intent (`enabled`), admin blocks and account suspension are independent facts.
// Clearing one never hides another; e.g. unblocking an expired link leaves it expired.

export function effectiveStatus({ adminBlockedAt, ownerStatus, ownerDisabledAt, expiresAt }, now) {
  if (adminBlockedAt) return 'blocked';
  if (ownerStatus === 'suspended') return 'ownerSuspended';
  if (ownerStatus === 'deactivated' || ownerStatus === 'deleted') return 'ownerDeactivated';
  if (ownerDisabledAt) return 'disabled';
  if (expiresAt && expiresAt <= now) return 'expired';

  return 'active';
}
