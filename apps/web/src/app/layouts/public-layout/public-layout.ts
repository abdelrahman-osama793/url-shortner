import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { Session } from '../../core/auth/session';
import { Icon } from '../../shared/ui/icon/icon';
import { Logo } from '../../shared/ui/logo/logo';
import { ThemeSwitcher } from '../../shared/ui/theme-switcher/theme-switcher';

// Public pages: Log in and Sign up stay visible at every width for visitors (decision D16);
// a signed-in person gets a way back to their links instead.
@Component({
  selector: 'app-public-layout',
  imports: [RouterOutlet, RouterLink, Icon, Logo, ThemeSwitcher],
  templateUrl: './public-layout.html',
  styleUrl: './public-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicLayout {
  protected readonly session = inject(Session);

  constructor() {
    // Visitors see Log in / Sign up until the check finishes, and if it fails.
    this.session.load().catch(() => null);
  }
}
