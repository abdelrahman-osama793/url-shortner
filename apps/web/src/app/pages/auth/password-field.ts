import { ChangeDetectionStrategy, Component, ElementRef, computed, input, model, signal, viewChild } from '@angular/core';
import { PASSWORD_MAX_LENGTH } from '@shortlist/contracts/constants';

import { Icon } from '../../shared/ui/icon';

// A password input with a Show/Hide toggle, an optional hint and an error message, all tied to
// the input with aria-describedby. The toggle is outside the <label>, so it is not read as part
// of the field's name.
@Component({
  selector: 'app-password-field',
  imports: [Icon],
  template: `
    <div class="field">
      <label [for]="fieldId()">{{ label() }}</label>
      <div class="password">
        <input
          #input
          class="input"
          [id]="fieldId()"
          [type]="visible() ? 'text' : 'password'"
          [attr.autocomplete]="autocomplete()"
          [attr.maxlength]="maxLength"
          [value]="value()"
          (input)="value.set(input.value)"
          [attr.aria-invalid]="error() ? 'true' : null"
          [attr.aria-describedby]="describedBy()"
          spellcheck="false"
          autocapitalize="off"
        />
        <button
          class="toggle"
          type="button"
          [attr.aria-label]="(visible() ? 'Hide ' : 'Show ') + label().toLowerCase()"
          [attr.aria-pressed]="visible()"
          (click)="visible.set(!visible())"
        >
          <app-icon [name]="visible() ? 'eye-off' : 'eye'" />
        </button>
      </div>
      @if (hint()) {
        <span class="field-hint" [id]="fieldId() + '-hint'">{{ hint() }}</span>
      }
      @if (error()) {
        <p class="field-error" [id]="fieldId() + '-error'" role="alert">{{ error() }}</p>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordField {
  readonly fieldId = input.required<string>();
  readonly label = input('Password');
  readonly autocomplete = input<'current-password' | 'new-password'>('current-password');
  readonly hint = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly value = model('');

  protected readonly maxLength = PASSWORD_MAX_LENGTH;
  protected readonly visible = signal(false);

  protected readonly describedBy = computed(() => {
    const ids = [this.hint() && `${this.fieldId()}-hint`, this.error() && `${this.fieldId()}-error`].filter(Boolean);

    return ids.length > 0 ? ids.join(' ') : null;
  });

  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');

  focus(): void {
    this.input().nativeElement.focus();
  }
}
