import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { Link, LinkListResponse, RegisteredCreateLinkRequest, UpdateLinkRequest } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

// The signed-in owner's links (api-contracts.md, "Links"). Every link carries its version, which
// is its ETag ("v3"): edits send it back in If-Match, so a change made elsewhere is answered
// with 412 instead of being silently overwritten.
@Injectable({ providedIn: 'root' })
export class Links {
  private readonly http = inject(HttpClient);

  async list(cursor: string | null = null, limit?: number): Promise<LinkListResponse> {
    const params: Record<string, string> = {
      ...(cursor ? { cursor } : {}),
      ...(limit ? { limit: String(limit) } : {}),
    };

    return firstValueFrom(this.http.get<LinkListResponse>('/api/v1/links', { params }));
  }

  async get(id: string): Promise<Link> {
    return firstValueFrom(this.http.get<Link>(`/api/v1/links/${encodeURIComponent(id)}`));
  }

  // The key makes a retried request (after a timeout or lost answer) return the original link
  // instead of creating a second one.
  async create(body: RegisteredCreateLinkRequest, idempotencyKey: string): Promise<Link> {
    const headers = new HttpHeaders({ 'Idempotency-Key': idempotencyKey });

    return firstValueFrom(this.http.post<Link>('/api/v1/links', body, { headers }));
  }

  async update(link: Pick<Link, 'id' | 'version'>, changes: UpdateLinkRequest): Promise<Link> {
    const headers = new HttpHeaders({ 'If-Match': `"v${link.version}"` });

    return firstValueFrom(this.http.patch<Link>(`/api/v1/links/${encodeURIComponent(link.id)}`, changes, { headers }));
  }
}
