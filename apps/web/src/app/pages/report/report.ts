import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, type OnInit, afterNextRender, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { REPORT_DETAILS_MAX_LENGTH } from '@shortlist/contracts/constants';
import { firstValueFrom } from 'rxjs';

import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

const CATEGORIES = [
  { value: 'phishing', label: 'Phishing', hint: 'Pretends to be someone else to collect passwords, payment or personal details.' },
  { value: 'malware', label: 'Malware', hint: 'Downloads or installs harmful software.' },
  { value: 'spam', label: 'Spam', hint: 'Unwanted bulk messages or misleading promotions.' },
  { value: 'other', label: 'Something else', hint: 'Another kind of harmful or illegal content.' },
] as const;

type Category = (typeof CATEGORIES)[number]['value'];

// "https://host/r/Abc123?x" → "Abc123"; anything without "/r/" is taken as the code itself.
// Codes are case-sensitive, so the case is kept.
export function extractCode(input: string): string {
  const value = input.trim();
  const match = value.match(/\/r\/([^/?#\s]+)/);

  if (!match) return value;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1]; // a malformed %-escape; the server treats it as an unknown code
  }
}

// Public abuse report (UI_HANDOFF "Reporting"). The confirmation is the same whatever was
// reported, because the API never says whether a code exists. Inputs are kept on every error.
@Component({
  selector: 'app-report',
  imports: [RouterLink, Icon],
  templateUrl: './report.html',
  styleUrl: './report.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReportPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly injector = inject(Injector);

  // ?code= prefills the link (for example from an inactive-link page).
  readonly code = input<string>();

  protected readonly categories = CATEGORIES;
  protected readonly maxDetails = REPORT_DETAILS_MAX_LENGTH;

  protected readonly link = signal('');
  protected readonly category = signal<Category | null>(null);
  protected readonly details = signal('');
  protected readonly busy = signal(false);
  protected readonly sent = signal(false);
  protected readonly errors = signal<{ link?: string; category?: string; details?: string }>({});
  protected readonly formError = signal<string | null>(null);

  private readonly heading = viewChild<ElementRef<HTMLElement>>('doneHeading');

  ngOnInit(): void {
    if (this.code()) this.link.set(this.code()!);
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    const code = extractCode(this.link());
    const errors = {
      link: code ? undefined : 'Enter the short link or its code.',
      category: this.category() ? undefined : 'Choose what is wrong with the link.',
      details: this.details().length > REPORT_DETAILS_MAX_LENGTH ? `Use at most ${REPORT_DETAILS_MAX_LENGTH} characters.` : undefined,
    };

    this.errors.set(errors);
    this.formError.set(null);

    if (errors.link || errors.category || errors.details) return;

    this.busy.set(true);

    try {
      const body = { code, category: this.category(), ...(this.details().trim() ? { details: this.details().trim() } : {}) };

      await firstValueFrom(this.http.post('/api/v1/reports', body));
      this.sent.set(true);
      afterNextRender(() => this.heading()?.nativeElement.focus(), { injector: this.injector });
    } catch (error) {
      const apiError = toApiError(error);

      if (apiError.code === 'VALIDATION_FAILED') {
        this.errors.set({
          link: apiError.fieldMessage('code') ? 'Enter a short link from this site, or its code.' : undefined,
          details: apiError.fieldMessage('details') ?? undefined,
        });
        if (!apiError.fieldMessage('code') && !apiError.fieldMessage('details')) this.formError.set(apiError.message);
      } else {
        this.formError.set(commonMessage(apiError));
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected reportAnother(): void {
    this.link.set('');
    this.category.set(null);
    this.details.set('');
    this.sent.set(false);
  }
}
