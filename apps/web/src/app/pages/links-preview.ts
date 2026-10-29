import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { EffectiveStatus } from '@shortlist/contracts';

import { Icon } from '../shared/ui/icon';
import { StatusBadge } from '../shared/ui/status-badge';

interface SampleLink {
  code: string;
  destination: string;
  status: EffectiveStatus;
  clicks: string;
}

// SAMPLE DATA ONLY. Shows the workspace layout and every status treatment until the real
// link list is connected in T26. Nothing here comes from the API.
const SAMPLE_LINKS: SampleLink[] = [
  { code: 'product-launch', destination: 'https://example.com/products/new-release', status: 'active', clicks: '1,284' },
  { code: 'october-notes', destination: 'https://example.com/newsletter/october', status: 'expired', clicks: '290' },
  { code: 'developer-guide', destination: 'https://example.com/docs/getting-started', status: 'disabled', clicks: '136' },
  { code: 'old-campaign', destination: 'https://example.com/campaigns/a-very-long-path/that-keeps-going/until-it-needs-to-wrap', status: 'blocked', clicks: '41' },
  { code: 'team-page', destination: 'https://example.com/team', status: 'ownerSuspended', clicks: '8' },
];

@Component({
  selector: 'app-links-preview',
  imports: [Icon, StatusBadge],
  templateUrl: './links-preview.html',
  styleUrl: './links-preview.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinksPreview {
  protected readonly links = SAMPLE_LINKS;
}
