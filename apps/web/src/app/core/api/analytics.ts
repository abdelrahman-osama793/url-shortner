import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { LinkAnalytics } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

// Owner-only click aggregates for one link (api-contracts.md, "Analytics contract").
// `from` inclusive, `to` exclusive, both UTC dates.
@Injectable({ providedIn: 'root' })
export class Analytics {
  private readonly http = inject(HttpClient);

  async forLink(linkId: string, range: { from: string; to: string }): Promise<LinkAnalytics> {
    return firstValueFrom(this.http.get<LinkAnalytics>(`/api/v1/links/${encodeURIComponent(linkId)}/analytics`, { params: range }));
  }
}
