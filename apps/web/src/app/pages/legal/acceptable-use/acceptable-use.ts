import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { Consent } from '../../../core/consent';
import { LEGAL_LAST_UPDATED, OPERATOR } from '../../../core/operator';

// Draft legal text written from the app's actual behaviour; operator details are placeholders
// (core/operator.ts). Not legal advice: the operator must review it before launch.
@Component({
  selector: 'app-acceptable-use',
  imports: [RouterLink],
  templateUrl: './acceptable-use.html',
  styleUrl: '../legal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AcceptableUsePolicy {
  protected readonly operator = OPERATOR;
  protected readonly updated = LEGAL_LAST_UPDATED;
  protected readonly consent = inject(Consent);
}
