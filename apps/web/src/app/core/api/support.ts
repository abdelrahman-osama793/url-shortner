import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AdminSupportMessage, SupportMessageRequest, SupportQueueResponse } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

export type SupportStatus = AdminSupportMessage['status'];

// Support messages (api-contracts.md, "Support"): anyone sends; only admins read and close.
@Injectable({ providedIn: 'root' })
export class SupportApi {
  private readonly http = inject(HttpClient);

  async send(message: SupportMessageRequest): Promise<void> {
    await firstValueFrom(this.http.post('/api/v1/support', message));
  }

  async inbox(status: SupportStatus, cursor: string | null = null): Promise<SupportQueueResponse> {
    const params: Record<string, string> = { status, ...(cursor ? { cursor } : {}) };

    return firstValueFrom(this.http.get<SupportQueueResponse>('/api/v1/admin/support', { params }));
  }

  async setStatus(id: string, status: SupportStatus): Promise<AdminSupportMessage> {
    return firstValueFrom(this.http.patch<AdminSupportMessage>(`/api/v1/admin/support/${encodeURIComponent(id)}`, { status }));
  }
}
