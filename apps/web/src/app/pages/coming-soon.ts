import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Icon } from '../shared/ui/icon';

// A labelled stand-in for screens built by later tasks, so every layout and link can be
// reviewed now without pretending the feature works. Text comes from the route's data.
@Component({
  selector: 'app-coming-soon',
  imports: [RouterLink, Icon],
  template: `
    <h1>{{ title() }}</h1>
    <p class="intro muted">{{ description() }}</p>
    <p class="mock-banner"><app-icon name="info" /> Preview: this screen is built in {{ task() }}. Nothing here is connected yet.</p>
    <a class="btn btn-secondary back" routerLink="/">Back to the home page</a>
  `,
  styles: `
    .intro {
      margin: 10px 0 22px;
      font-size: 15px;
    }

    .back {
      margin-top: 22px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComingSoon {
  readonly title = input('');
  readonly description = input('');
  readonly task = input('a later task');
}
