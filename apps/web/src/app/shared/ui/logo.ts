import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from './icon';

// The Shortlist wordmark with its tilted petrol mark; links home.
@Component({
  selector: 'app-logo',
  imports: [RouterLink, Icon],
  template: `
    <a class="logo" routerLink="/" aria-label="Shortlist home">
      <span class="mark"><app-icon name="link-2" [size]="17" /></span>
      <span aria-hidden="true">shortlist</span>
    </a>
  `,
  styles: `
    .logo {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      min-height: 44px;
      color: var(--ink);
      font-size: 21px;
      font-weight: 800;
      letter-spacing: -0.8px;
      text-decoration: none;
      border-radius: 4px;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: var(--night);
      color: var(--lime);
      transform: rotate(-8deg);
    }

    .mark app-icon {
      transform: rotate(8deg);
    }

    @media (max-width: 600px) {
      .logo {
        font-size: 19px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {}
