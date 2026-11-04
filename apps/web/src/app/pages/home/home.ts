import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Session } from '../../core/auth/session';
import { Icon } from '../../shared/ui/icon/icon';

import { ShortenForm } from '../shorten-form/shorten-form';

// Public home (UI_HANDOFF "Public home"): hero, illustration, the guest shortening form, then
// what Shortlist does. Every claim here describes implemented behaviour (PRODUCT.md: tell the truth).
@Component({
  selector: 'app-home',
  imports: [RouterLink, Icon, ShortenForm],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  protected readonly signedIn = inject(Session).signedIn;

  protected readonly comparison: { feature: string; guest: boolean | string; account: true | string }[] = [
    { feature: 'Create short links', guest: true, account: true },
    { feature: 'Link lifetime', guest: '7 days', account: 'Until you set an expiry' },
    { feature: 'Custom alias', guest: false, account: true },
    { feature: 'Change the destination', guest: false, account: true },
    { feature: 'Pause and resume', guest: false, account: true },
    { feature: 'Clicks by day, country, device and referring site', guest: false, account: true },
  ];

  // Heights of the decorative sparkline bars, in pixels.
  protected readonly spark = [19, 25, 22, 35, 31, 43, 50];
}
