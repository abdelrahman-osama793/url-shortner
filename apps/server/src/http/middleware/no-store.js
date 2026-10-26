// Every API and redirect response is non-cacheable (api-contracts.md, Conventions).
// Caching would let browsers or CDNs serve a destination after an owner changed or disabled it.
export function noStore() {
  return (_req, res, next) => {
    res.set('Cache-Control', 'no-store');

    next();
  };
}
