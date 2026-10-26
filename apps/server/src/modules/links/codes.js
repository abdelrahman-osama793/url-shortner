import { randomInt } from 'node:crypto';

import { GENERATED_CODE_LENGTH } from '@shortlist/contracts';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

// randomInt draws uniformly from a cryptographically secure source. The common shortcut
// `randomByte % 62` is biased, because 256 is not a multiple of 62.
export function generateCode(length = GENERATED_CODE_LENGTH) {
  let code = '';

  for (let i = 0; i < length; i += 1) {
    code += BASE62[randomInt(BASE62.length)];
  }

  return code;
}
