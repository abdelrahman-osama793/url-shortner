import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '../shared/ui/icon';

// Public home. The hero, illustration and benefits are final content; the shortening form is
// connected to the API in T24 and is shown here as a labelled preview only.
@Component({
  selector: 'app-home',
  imports: [RouterLink, Icon],
  templateUrl: './home.html',
  styleUrl: './home.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  // Heights of the decorative sparkline bars, in pixels.
  protected readonly spark = [19, 25, 22, 35, 31, 43, 50];
}
