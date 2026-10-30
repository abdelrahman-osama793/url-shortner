import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { Accounts } from '../core/auth/accounts';
import { Session } from '../core/auth/session';
import { commonMessage, toApiError } from '../core/http/api-error';
import { Icon } from '../shared/ui/icon';
import type { IconName } from '../shared/ui/icons';
import { Logo } from '../shared/ui/logo';
import { ThemeSwitcher } from '../shared/ui/theme-switcher';

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
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="top">
      <app-logo />
      <nav class="account" aria-label="Account">
        <a class="btn" routerLink="/app/account" [attr.aria-label]="'Account: ' + (session.user()?.email ?? '')">
          <span class="avatar" aria-hidden="true"><app-icon name="user" [size]="14" /></span>
          <span class="email">{{ session.user()?.email }}</span>
        </a>
        <button class="btn" type="button" (click)="logOut()" [disabled]="loggingOut()">
          Log out <app-icon name="log-out" [size]="16" />
        </button>
      </nav>
    </header>

    <div class="frame">
      <aside class="sidebar">
        <div class="workspace">
          <span class="workspace-icon"><app-icon name="layers" /></span>
          Personal workspace
        </div>

        <nav class="side-nav" aria-label="Workspace">
          @for (item of navItems(); track item.path) {
            <a
              class="btn nav-link"
              [routerLink]="item.path"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
            >
              <app-icon [name]="item.icon" />{{ item.label }}
            </a>
          }
        </nav>

        <div class="sidebar-bottom">
          <a class="btn btn-link" routerLink="/">View public page <app-icon name="arrow-up-right" [size]="14" /></a>
          <a class="btn btn-link" routerLink="/report">Report a link</a>
          <app-theme-switcher />
        </div>
      </aside>

      <main id="main" class="main" tabindex="-1">
        @if (session.user()?.emailVerified === false) {
          <div class="verify-banner" role="region" aria-label="Email verification">
            <p><strong>Verify your email to create links.</strong> Open the link we sent to {{ session.user()?.email }}.</p>
            @if (resendState() === 'sent') {
              <p class="status-text" role="status">A new link is on its way.</p>
            } @else {
              <button class="btn btn-secondary" type="button" (click)="resend()" [disabled]="resendState() === 'sending'">
                {{ resendState() === 'sending' ? 'Sending…' : 'Resend email' }}
              </button>
            }
            @if (resendError(); as message) {
              <p class="form-error" role="alert">{{ message }}</p>
            }
          </div>
        }
        @if (logoutError(); as message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <router-outlet />
      </main>
    </div>
  `,
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
