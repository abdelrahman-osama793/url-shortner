import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

// Account emails and one-time tokens (api-contracts.md, "Authentication"). Requests that send
// an email always answer 202, whether or not the account exists, so nothing here can reveal it.
@Injectable({ providedIn: 'root' })
export class Accounts {
  private readonly http = inject(HttpClient);

  async register(email: string, password: string): Promise<void> {
    await this.post('/api/v1/auth/register', { email, password });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.post('/api/v1/auth/email/verify', { token });
  }

  async resendVerification(email: string): Promise<void> {
    await this.post('/api/v1/auth/email/resend', { email });
  }

  async forgotPassword(email: string): Promise<void> {
    await this.post('/api/v1/auth/password/forgot', { email });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.post('/api/v1/auth/password/reset', { token, newPassword });
  }

  private async post(url: string, body: object): Promise<void> {
    await firstValueFrom(this.http.post(url, body));
  }
}
