import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, isDevMode, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { GuestCreateLinkResponse } from '@shortlist/contracts';

import { DevChallenge, GuestLinks } from '../core/api/guest-links';
import { ApiError, describeWait, toApiError } from '../core/http/api-error';
import { Icon } from '../shared/ui/icon';

type Step = 'form' | 'challenge' | 'result';

// The guest journey on the home page (decision D04; UI_HANDOFF "Public creation"):
// paste a URL → real POST /api/v1/links → short link with its 7-day expiry and a Copy button.
// Rate limits, verification challenges, invalid URLs and outages each get their own message.
@Component({
  selector: 'app-shorten-form',
  imports: [RouterLink, Icon],
  templateUrl: './shorten-form.html',
  styleUrl: './shorten-form.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShortenForm {
  private readonly guestLinks = inject(GuestLinks);
  private readonly devChallenge = inject(DevChallenge);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  // A real challenge provider is integrated in T37; until then only development builds can pass one.
  protected readonly devChallengeAvailable = isDevMode();

  protected readonly destination = signal('');
  protected readonly step = signal<Step>('form');
  protected readonly busy = signal(false);
  protected readonly fieldError = signal<string | null>(null);
  protected readonly formError = signal<string | null>(null);
  protected readonly result = signal<GuestCreateLinkResponse | null>(null);
  protected readonly copyState = signal<'idle' | 'copied' | 'failed'>('idle');

  protected readonly expiry = computed(() => {
    const result = this.result();

    return result ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(result.expiresAt)) : '';
  });

  private readonly resultField = viewChild<ElementRef<HTMLInputElement>>('resultField');
  private readonly destinationField = viewChild<ElementRef<HTMLInputElement>>('destinationField');
  // The first action of the challenge step: "Complete verification" in development, otherwise Cancel.
  private readonly challengeAction = viewChild<ElementRef<HTMLButtonElement>>('challengeAction');

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy()) return;

    if (this.destination().trim() === '') {
      this.fieldError.set('Paste the link you want to shorten.');
      this.destinationField()?.nativeElement.focus();
      return;
    }

    await this.create();
  }

  // Development only: obtain a mock challenge token, then retry the same request with it.
  protected async completeDevChallenge(): Promise<void> {
    this.busy.set(true);
    this.formError.set(null);

    try {
      await this.create(await this.devChallenge.issue());
    } catch (error) {
      this.showError(toApiError(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(): Promise<void> {
    const shortUrl = this.result()?.shortUrl;

    if (!shortUrl) return;

    try {
      await this.document.defaultView?.navigator.clipboard.writeText(shortUrl);
      this.copyState.set('copied');
    } catch {
      // No clipboard access: leave the link selected so it can be copied by hand.
      this.copyState.set('failed');
      this.resultField()?.nativeElement.select();
    }
  }

  protected startOver(): void {
    this.destination.set('');
    this.result.set(null);
    this.copyState.set('idle');
    this.step.set('form');
    this.focusAfterRender(() => this.destinationField());
  }

  protected cancelChallenge(): void {
    this.formError.set(null);
    this.step.set('form');
    this.focusAfterRender(() => this.destinationField());
  }

  protected onInput(value: string): void {
    this.destination.set(value);
    this.fieldError.set(null);
  }

  private async create(challengeToken?: string): Promise<void> {
    this.busy.set(true);
    this.fieldError.set(null);
    this.formError.set(null);

    try {
      const result = await this.guestLinks.create(this.destination().trim(), challengeToken);

      this.result.set(result);
      this.copyState.set('idle');
      this.step.set('result');
      this.focusAfterRender(() => this.resultField());
    } catch (error) {
      this.showError(toApiError(error));
    } finally {
      this.busy.set(false);
    }
  }

  // Moves keyboard focus once Angular has rendered the new step. (A microtask would run before
  // rendering, when the element does not exist yet, and focus would fall back to <body>.)
  private focusAfterRender(target: () => ElementRef<HTMLElement> | undefined): void {
    afterNextRender(() => target()?.nativeElement.focus(), { injector: this.injector });
  }

  private showError(error: ApiError): void {
    // Any answer other than a new challenge ends the challenge step; its buttons (which may have
    // had focus) disappear, so keyboard focus returns to the field.
    if (this.step() === 'challenge' && error.code !== 'CHALLENGE_REQUIRED') {
      this.step.set('form');
      this.focusAfterRender(() => this.destinationField());
    }

    switch (error.code) {
      case 'VALIDATION_FAILED':
        this.fieldError.set(error.fieldMessage('destinationUrl') ?? 'Enter a complete link starting with http:// or https://.');
        break;
      case 'CHALLENGE_REQUIRED':
        this.step.set('challenge');
        this.formError.set(error.message);
        // The submit button that had focus is gone; keep keyboard users in the flow.
        this.focusAfterRender(() => this.challengeAction());
        break;
      case 'RATE_LIMITED':
        this.formError.set(`You've created a lot of links from this network. Please try again in ${describeWait(error.retryAfterSeconds ?? 60)}, or sign up for a higher limit.`);
        break;
      case 'SERVICE_UNAVAILABLE':
        this.formError.set('Shortlist is briefly unavailable. Please try again in a moment.');
        break;
      default:
        this.formError.set(error.message);
    }
  }
}
