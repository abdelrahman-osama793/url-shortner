import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { Icon } from '../../shared/ui/icon/icon';

// Sign-in, sign-up and recovery screens, inside the public layout so Log in / Sign up and the
// footer stay available. Desktop pairs a branded story panel with the form; on phones the
// story panel is hidden so the form comes first.
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, Icon],
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthLayout {}
