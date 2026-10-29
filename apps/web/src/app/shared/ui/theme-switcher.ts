import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { Theme, type ThemePreference } from '../../core/theme';
import { Icon } from './icon';
import type { IconName } from './icons';

// A labelled radio group: keyboard and screen-reader friendly without custom key handling.
@Component({
  selector: 'app-theme-switcher',
  imports: [Icon],
  template: `
    <fieldset class="switcher">
      <legend class="visually-hidden">Appearance</legend>
      @for (option of options; track option.value) {
        <label class="option" [class.selected]="theme.preference() === option.value">
          <input
            class="visually-hidden"
            type="radio"
            name="theme"
            [value]="option.value"
            [checked]="theme.preference() === option.value"
            (change)="theme.set(option.value)"
          />
          <app-icon [name]="option.icon" [size]="15" />
          <span class="visually-hidden">{{ option.label }}</span>
        </label>
      }
    </fieldset>
  `,
  styles: `
    .switcher {
      display: inline-flex;
      gap: 2px;
      margin: 0;
      padding: 3px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--paper);
    }

    .option {
      display: grid;
      place-items: center;
      width: 36px;
      height: 32px;
      border-radius: 7px;
      color: var(--muted);
      cursor: pointer;
    }

    .option.selected {
      background: var(--accent-soft);
      color: var(--accent);
    }

    .option:has(input:focus-visible) {
      outline: 3px solid var(--accent);
      outline-offset: 2px;
    }

    @media (pointer: coarse) {
      .option {
        width: 44px;
        height: 44px;
      }
    }
  `,
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
