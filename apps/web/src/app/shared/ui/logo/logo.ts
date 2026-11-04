import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '../icon/icon';

// The Shortlist wordmark with its tilted petrol mark; links home.
@Component({
  selector: 'app-logo',
  imports: [RouterLink, Icon],
  templateUrl: './logo.html',
  styleUrl: './logo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {}
