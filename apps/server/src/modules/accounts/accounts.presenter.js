// Converts user rows into the API shape defined in @shortlist/contracts (UserSchema).

// Never includes the session version or any credential.
export function toUserResource(row) {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.email_verified_at !== null,
    role: row.role,
    status: row.status,
  };
}
