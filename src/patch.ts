import { createHash } from "node:crypto";
import HttpClient from "picnic-api/lib/http-client";
import { AuthService } from "picnic-api/lib/domains/auth/service";

async function readJsonOrNull(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

HttpClient.prototype.sendRequest = async function (
  this: any,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data: any = null,
  includePicnicHeaders = false,
  isImageRequest = false,
) {
  const headers = new Headers({
    ...this.baseHeaders,
    ...(includePicnicHeaders ? this.picnicHeaders : {}),
  });
  const res = await fetch(`${this.url}${path}`, {
    method,
    headers,
    body: data ? JSON.stringify(data) : null,
  });
  if (!res.ok) {
    const body = await readJsonOrNull(res);
    const msg = body?.error?.message ?? body?.message ?? res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  if (isImageRequest) return res.arrayBuffer();
  return readJsonOrNull(res);
};

AuthService.prototype.login = async function (this: any, username: string, password: string) {
  const secret = createHash("md5").update(password, "utf8").digest("hex");
  const res = await fetch(`${this.http.url}/user/login`, {
    method: "POST",
    headers: { ...this.http.baseHeaders, ...this.http.picnicHeaders },
    body: JSON.stringify({ key: username, secret, client_id: 30100 }),
  });
  const body = await readJsonOrNull(res);
  if (!res.ok) {
    const msg = body?.error?.message ?? res.statusText;
    throw new Error(`Login failed (${res.status}): ${msg}`);
  }
  const authKey = res.headers.get("x-picnic-auth");
  if (!authKey) throw new Error("Login response missing x-picnic-auth header.");
  this.http.authKey = authKey;
  return {
    authKey,
    second_factor_authentication_required: body?.second_factor_authentication_required ?? false,
    show_second_factor_authentication_intro: body?.show_second_factor_authentication_intro ?? false,
    user_id: body?.user_id,
  };
};
