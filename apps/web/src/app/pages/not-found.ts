import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <h1>Page not found</h1>
      <p class="muted">The page you were looking for does not exist.</p>
      <a class="btn btn-primary" routerLink="/">Go to the home page</a>
    </div>
  `,
  styles: `
    .wrap {
      display: grid;
      justify-items: start;
      gap: 14px;
      max-width: 520px;
      margin: 0 auto;
      padding: 64px 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {}
