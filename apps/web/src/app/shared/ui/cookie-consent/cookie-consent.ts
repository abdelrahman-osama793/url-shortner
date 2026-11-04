import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Consent } from '../../../core/consent';

// The cookie banner (until a choice is made) and the cookie settings dialog (from the banner or
// the "Cookie settings" footer link). Rejecting is as easy as accepting: both are one click.
@Component({
  selector: 'app-cookie-consent',
  imports: [RouterLink],
  templateUrl: './cookie-consent.html',
  styleUrl: './cookie-consent.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CookieConsent {
  protected readonly consent = inject(Consent);

  protected readonly preferences = signal(false);
  protected readonly google = signal(false);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;

      if (this.consent.settingsOpen()) {
        const current = this.consent.current();

        this.preferences.set(current.preferences);
        this.google.set(current.google);
        if (!dialog.open) dialog.showModal();
      } else if (dialog.open) {
        dialog.close();
      }
    });
  }

  protected saveSettings(): void {
    this.consent.save({ preferences: this.preferences(), google: this.google() });
  }
}
