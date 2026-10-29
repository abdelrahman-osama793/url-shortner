import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Theme } from './core/theme';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class App {
  // Applies the stored appearance (light, dark or system) as soon as the app starts.
  protected readonly theme = inject(Theme);
}
