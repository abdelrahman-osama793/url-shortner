import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AdminLink, AdminReport, AdminUser, AuditListResponse, ReportQueueResponse } from '@shortlist/contracts';
import { firstValueFrom } from 'rxjs';

export type ReportStatus = AdminReport['status'];
export interface AuditTarget {
  targetType: 'link' | 'user' | 'report';
  targetId: string;
}

// Administration API (api-contracts.md, "Reports and moderation"). Changes need a reason, recent
// authentication and, for links, the version being changed; the server enforces every rule and
// records each change in the audit trail.
@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly http = inject(HttpClient);

  async reports(status: ReportStatus, cursor: string | null = null): Promise<ReportQueueResponse> {
    const params: Record<string, string> = { status, ...(cursor ? { cursor } : {}) };

    return firstValueFrom(this.http.get<ReportQueueResponse>('/api/v1/admin/reports', { params }));
  }

  async setReportStatus(id: string, status: ReportStatus, note: string): Promise<AdminReport> {
    return firstValueFrom(this.http.patch<AdminReport>(`/api/v1/admin/reports/${encodeURIComponent(id)}`, { status, note }));
  }

  async link(code: string): Promise<AdminLink> {
    return firstValueFrom(this.http.get<AdminLink>('/api/v1/admin/links', { params: { code } }));
  }

  async setLinkBlocked(link: Pick<AdminLink, 'id' | 'version'>, blocked: boolean, reason: string): Promise<AdminLink> {
    const headers = new HttpHeaders({ 'If-Match': `"v${link.version}"` });

    return firstValueFrom(this.http.patch<AdminLink>(`/api/v1/admin/links/${encodeURIComponent(link.id)}/moderation`, { blocked, reason }, { headers }));
  }

  async setUserSuspended(userId: string, suspended: boolean, reason: string): Promise<AdminUser> {
    return firstValueFrom(this.http.patch<AdminUser>(`/api/v1/admin/users/${encodeURIComponent(userId)}/moderation`, { suspended, reason }));
  }

  async audit(target: AuditTarget | null, cursor: string | null = null): Promise<AuditListResponse> {
    const params: Record<string, string> = { ...(target ?? {}), ...(cursor ? { cursor } : {}) };

    return firstValueFrom(this.http.get<AuditListResponse>('/api/v1/admin/audit', { params }));
  }
}
