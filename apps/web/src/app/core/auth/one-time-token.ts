import { DOCUMENT, Location } from '@angular/common';
import { inject } from '@angular/core';

// Reads the token from an email link (…#token=…) and removes it from the address bar, so it does
// not linger in history, bookmarks or screenshots. Fragments are never sent to servers.
// Call from an injection context (a component field or constructor).
export function takeFragmentToken(): string | null {
  const document = inject(DOCUMENT);
  const location = inject(Location);

  const token = new URLSearchParams(document.location.hash.slice(1)).get('token');

  location.replaceState(location.path(false));

  return token || null;
}
