import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Icon } from '../shared/ui/icon';

import { ShortenForm } from './shorten-form';

// Public home (UI_HANDOFF "Public home"): hero, illustration, the guest shortening form and benefits.
@Component({
  selector: 'app-home',
  imports: [Icon, ShortenForm],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  // Heights of the decorative sparkline bars, in pixels.
  protected readonly spark = [19, 25, 22, 35, 31, 43, 50];
}
