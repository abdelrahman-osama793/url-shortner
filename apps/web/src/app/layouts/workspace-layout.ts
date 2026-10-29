import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

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
// roles (T30). `isAdmin` and the account summary come from the session once sign-in is
// connected (T25/T28).
@Component({
  selector: 'app-workspace-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Logo, ThemeSwitcher],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="top">
      <app-logo />
      <nav class="account" aria-label="Account">
        <a class="btn" routerLink="/app/account">
          <span class="avatar" aria-hidden="true"><app-icon name="user" [size]="14" /></span>
          Account
        </a>
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
        <router-outlet />
      </main>
    </div>
  `,
  styleUrl: './workspace-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceLayout {
  readonly isAdmin = input(false);

  protected navItems(): NavItem[] {
    const items: NavItem[] = [
      { path: '/app/links', label: 'Your links', icon: 'link' },
      { path: '/app/analytics', label: 'Analytics', icon: 'chart' },
      { path: '/app/account', label: 'Account', icon: 'user' },
    ];

    return this.isAdmin() ? [...items, { path: '/app/admin', label: 'Administration', icon: 'shield-check' }] : items;
  }
}
