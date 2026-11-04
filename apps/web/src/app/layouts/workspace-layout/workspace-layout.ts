import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Accounts } from '../../core/auth/accounts';
import { Session } from '../../core/auth/session';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon/icon';
import type { IconName } from '../../shared/ui/icons';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeSwitcher } from '../../shared/ui/theme-switcher/theme-switcher';

interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

// The signed-in workspace: sidebar navigation on desktop, a wrapping row of links on phones.
// Administration appears only for admins; hiding it is a convenience, the server enforces
// roles (T30). An unverified account is signed in with restricted rights: a banner explains
// that links need a verified email and resends the link.
@Component({
  selector: 'app-workspace-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, ThemeSwitcher],
  templateUrl: './workspace-layout.html',
  styleUrl: './workspace-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceLayout {
  protected readonly session = inject(Session);
  private readonly accounts = inject(Accounts);
  private readonly router = inject(Router);

  protected readonly loggingOut = signal(false);
  protected readonly logoutError = signal<string | null>(null);
  protected readonly resendState = signal<'idle' | 'sending' | 'sent'>('idle');
  protected readonly resendError = signal<string | null>(null);

  private readonly isAdmin = computed(() => this.session.user()?.role === 'admin');

  protected async logOut(): Promise<void> {
    this.loggingOut.set(true);
    this.logoutError.set(null);

    try {
      await this.session.logOut();
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.logoutError.set(commonMessage(toApiError(error)));
    } finally {
      this.loggingOut.set(false);
    }
  }

  protected async resend(): Promise<void> {
    const email = this.session.user()?.email;

    if (!email) return;

    this.resendState.set('sending');
    this.resendError.set(null);

    try {
      await this.accounts.resendVerification(email);
      this.resendState.set('sent');
    } catch (error) {
      this.resendState.set('idle');
      this.resendError.set(commonMessage(toApiError(error)));
    }
  }

  protected navItems(): NavItem[] {
    const items: NavItem[] = [
      { path: '/app/links', label: 'Your links', icon: 'link' },
      { path: '/app/analytics', label: 'Analytics', icon: 'chart' },
      { path: '/app/account', label: 'Account', icon: 'user' },
    ];

    return this.isAdmin() ? [...items, { path: '/app/admin', label: 'Administration', icon: 'shield-check' }] : items;
  }
}
