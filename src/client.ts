import PicnicClient from "picnic-api";
import type { AuthState } from "./auth.ts";

type CountryCode = "NL" | "DE";

export function makeClient(opts: { auth?: AuthState | null; countryCode?: CountryCode } = {}) {
  const countryCode =
    opts.countryCode ??
    opts.auth?.countryCode ??
    ((process.env.PICNIC_COUNTRY ?? "DE").toUpperCase() as CountryCode);
  return new PicnicClient({
    countryCode,
    ...(opts.auth?.authKey ? { authKey: opts.auth.authKey } : {}),
  });
}
