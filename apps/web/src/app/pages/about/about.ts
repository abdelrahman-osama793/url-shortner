import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { OPERATOR } from '../../core/operator';

// About Shortlist (T44): what it is, what it stands for, and who runs it (placeholders until the
// operator fills in core/operator.ts).
@Component({
  selector: 'app-about',
  imports: [RouterLink],
  templateUrl: './about.html',
  styleUrl: '../legal/legal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutPage {
  protected readonly operator = OPERATOR;
}
