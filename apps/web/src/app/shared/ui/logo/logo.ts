import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Session } from '../../../core/auth/session';
import { Icon } from '../icon/icon';

// The Shortlist wordmark with its tilted petrol mark. Links home: the workspace when signed in,
// otherwise the public landing page.
@Component({
  selector: 'app-logo',
  imports: [RouterLink, Icon],
  templateUrl: './logo.html',
  styleUrl: './logo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Logo {
  private readonly session = inject(Session);

  protected readonly home = computed(() => (this.session.signedIn() ? '/app/links' : '/'));
}
