import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, type OnInit, afterNextRender, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { Link, UpdateLinkRequest } from '@shortlist/contracts';
import { ALIAS_PATTERN, DESTINATION_MAX_LENGTH } from '@shortlist/contracts/constants';

import { Links } from '../../core/api/links';
import { commonMessage, toApiError } from '../../core/http/api-error';
import { Icon } from '../../shared/ui/icon';

import { fromDateInput, toDateInput, todayInput } from './expiry';

// Creates a link, or edits one. Inputs are never cleared by an error, so nothing typed is lost.
// Edits send the version they started from; if the link changed in the meantime (another tab or
// device), the server answers 412 and the editor loads the newer version, shows what changed,
// and keeps the person's input so they decide whether to save over it.
type FieldErrors = Partial<Record<'destinationUrl' | 'customAlias' | 'expiresAt', string>>;

@Component({
  selector: 'app-link-editor',
  imports: [DatePipe, Icon],
  templateUrl: './link-editor.html',
  styleUrl: './link-editor.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkEditor implements OnInit {
  private readonly links = inject(Links);

  // null: create a new link.
  readonly link = input<Link | null>(null);
  readonly saved = output<Link>();
  readonly closed = output<void>();

  protected readonly maxLength = DESTINATION_MAX_LENGTH;
  protected readonly today = todayInput();

  protected readonly destination = signal('');
  protected readonly alias = signal('');
  protected readonly expiry = signal('');
  protected readonly busy = signal(false);
  protected readonly errors = signal<FieldErrors>({});
  protected readonly formError = signal<string | null>(null);
  // The newer version found after a 412; edits are now based on it.
  protected readonly conflict = signal<Link | null>(null);

  protected readonly editing = computed(() => this.link() !== null);
  protected readonly base = computed(() => this.conflict() ?? this.link());

  private readonly destinationField = viewChild.required<ElementRef<HTMLInputElement>>('destinationField');

  // One key per distinct create request: a retry of the same request reuses it.
  private lastCreate: { body: string; key: string } | null = null;

  constructor() {
    afterNextRender(() => this.destinationField().nativeElement.focus());
  }

  ngOnInit(): void {
    const link = this.link();

    if (link) {
      this.destination.set(link.destinationUrl);
      this.expiry.set(toDateInput(link.expiresAt));
    }
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();

    if (this.busy() || !this.validate()) return;

    this.busy.set(true);
    this.formError.set(null);

    try {
      const base = this.base();
      const link = base ? await this.save(base) : await this.create();

      if (link) this.saved.emit(link);
    } catch (error) {
      await this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  private validate(): boolean {
    const errors: FieldErrors = {};

    if (!/^https?:\/\/\S+$/i.test(this.destination().trim())) errors.destinationUrl = 'Enter a complete link starting with http:// or https://.';
    if (!this.editing() && this.alias().trim() && !ALIAS_PATTERN.test(this.alias().trim())) {
      errors.customAlias = 'Use 4–32 letters, numbers, hyphens or underscores.';
    }
    if (this.expiry() && this.expiry() < this.today) errors.expiresAt = 'Choose today or a later date.';

    this.errors.set(errors);

    return Object.keys(errors).length === 0;
  }

  private async create(): Promise<Link> {
    const body = {
      destinationUrl: this.destination().trim(),
      customAlias: this.alias().trim() || null,
      expiresAt: fromDateInput(this.expiry()),
    };
    const serialized = JSON.stringify(body);

    if (this.lastCreate?.body !== serialized) this.lastCreate = { body: serialized, key: crypto.randomUUID() };

    return this.links.create(body, this.lastCreate.key);
  }

  // Sends only what changed; returns null (and says so) when nothing did.
  private async save(base: Link): Promise<Link | null> {
    const changes: UpdateLinkRequest = {};
    const destinationUrl = this.destination().trim();
    const expiresAt = fromDateInput(this.expiry());

    if (destinationUrl !== base.destinationUrl) changes.destinationUrl = destinationUrl;
    if (toDateInput(expiresAt) !== toDateInput(base.expiresAt)) changes.expiresAt = expiresAt;

    if (Object.keys(changes).length === 0) {
      this.formError.set('Nothing has changed yet.');
      return null;
    }

    return this.links.update(base, changes);
  }

  private async showError(error: unknown): Promise<void> {
    const apiError = toApiError(error);

    switch (apiError.code) {
      case 'VALIDATION_FAILED':
        this.errors.set({
          destinationUrl: apiError.fieldMessage('destinationUrl') ?? undefined,
          customAlias: apiError.fieldMessage('customAlias') ?? undefined,
          expiresAt: apiError.fieldMessage('expiresAt') ?? undefined,
        });
        if (apiError.fields.length === 0) this.formError.set(apiError.message);
        break;
      case 'ALIAS_UNAVAILABLE':
        this.errors.set({ customAlias: 'That alias is taken or reserved. Try another.' });
        break;
      case 'PRECONDITION_FAILED':
        await this.loadNewerVersion();
        break;
      case 'NOT_FOUND':
        this.formError.set('This link no longer exists.');
        break;
      case 'EMAIL_NOT_VERIFIED':
        this.formError.set('Verify your email address before creating links.');
        break;
      default:
        this.formError.set(commonMessage(apiError));
    }
  }

  private async loadNewerVersion(): Promise<void> {
    try {
      this.conflict.set(await this.links.get(this.base()!.id));
    } catch (error) {
      this.formError.set(commonMessage(toApiError(error)));
    }
  }
}
