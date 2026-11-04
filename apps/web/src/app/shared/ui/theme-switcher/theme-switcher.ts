import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Theme, type ThemePreference } from '../../../core/theme';
import { Icon } from '../icon/icon';
import type { IconName } from '../icons';

// A labelled radio group: keyboard and screen-reader friendly without custom key handling.
@Component({
  selector: 'app-theme-switcher',
  imports: [Icon],
  templateUrl: './theme-switcher.html',
  styleUrl: './theme-switcher.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeSwitcher {
  protected readonly theme = inject(Theme);

  protected readonly options: { value: ThemePreference; label: string; icon: IconName }[] = [
    { value: 'system', label: 'Match system appearance', icon: 'monitor' },
    { value: 'light', label: 'Light appearance', icon: 'sun' },
    { value: 'dark', label: 'Dark appearance', icon: 'moon' },
  ];
}
