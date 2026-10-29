import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { Icon } from '../shared/ui/icon';
import { Logo } from '../shared/ui/logo';
import { ThemeSwitcher } from '../shared/ui/theme-switcher';

// Public pages: Log in and Sign up stay visible at every width (decision D16).
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, Icon, Logo, ThemeSwitcher],
  template: `
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="top">
      <app-logo />
      <nav class="actions" aria-label="Account">
        <a class="btn shortcut" routerLink="/" fragment="shorten">Shorten a link</a>
        <a class="btn" routerLink="/login">Log in</a>
        <a class="btn btn-primary" routerLink="/signup">Sign up <app-icon name="arrow-right" /></a>
      </nav>
    </header>

    <main id="main" tabindex="-1">
      <router-outlet />
    </main>

    <footer class="bottom">
      <span>shortlist · A considered home for your links.</span>
      <div class="bottom-actions">
        <a class="btn btn-link" routerLink="/report">Report abuse <app-icon name="flag" [size]="14" /></a>
        <app-theme-switcher />
      </div>
    </footer>
  `,
  styleUrl: './public-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicLayout {}
