import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { GuestCreateLinkResponse } from '@shortlist/contracts';
import { GUEST_CREATE_CHALLENGE_ACTION } from '@shortlist/contracts/constants';
import { firstValueFrom } from 'rxjs';

import { toApiError } from '../http/api-error';

// Guest link creation (POST /api/v1/links from an anonymous session). Errors are ApiError.
@Injectable({ providedIn: 'root' })
export class GuestLinks {
  private readonly http = inject(HttpClient);

  async create(destinationUrl: string, challengeToken?: string): Promise<GuestCreateLinkResponse> {
    try {
      return await firstValueFrom(this.http.post<GuestCreateLinkResponse>('/api/v1/links', { destinationUrl, challengeToken }));
    } catch (error) {
      throw toApiError(error);
    }
  }
}

// DEVELOPMENT ONLY. Gets a mock challenge token from the development endpoint, standing in
// for a real human-verification widget until a provider is integrated (T37). The endpoint does
// not exist in production, and the UI only offers this in development builds.
@Injectable({ providedIn: 'root' })
export class DevChallenge {
  private readonly http = inject(HttpClient);

  async issue(action = GUEST_CREATE_CHALLENGE_ACTION): Promise<string> {
    try {
      const { challengeToken } = await firstValueFrom(this.http.post<{ challengeToken: string }>('/api/v1/dev/challenge-token', { action }));

      return challengeToken;
    } catch (error) {
      throw toApiError(error);
    }
  }
}
