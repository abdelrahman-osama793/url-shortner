import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Icon } from '../shared/ui/icon';

// Sign-in, sign-up and recovery screens, inside the public layout so Log in / Sign up and the
// footer stay available. Desktop pairs a branded story panel with the form; on phones the
// story panel is hidden so the form comes first.
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, Icon],
  template: `
    <div class="auth">
      <aside class="story on-dark" aria-label="About Shortlist">
        <div>
          <!-- Decorative brand copy, not a heading: the form's h1 is the page's first heading. -->
          <p class="story-title">Your links.<br />Your story.<br /><span>All in one place.</span></p>
          <p>A home for everything you share, from your next project to your everyday work.</p>
          <div class="example">
            <span>One memorable address</span>
            <strong>shortlist/r/your-idea</strong>
          </div>
          <ul class="benefits">
            <li><app-icon name="check" /> Make a short link your own</li>
            <li><app-icon name="check" /> See how people find you</li>
            <li><app-icon name="check" /> Change the destination anytime</li>
          </ul>
        </div>
        <span class="tagline">Built around the things you share.</span>
      </aside>

      <div class="content">
        <div class="box">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
  styleUrl: './auth-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayout {}
