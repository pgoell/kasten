import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One agent token as the store may be read: a name and when it was made. */
export type Token = components["schemas"]["Token"];

/** One agent token as it is handed over, secret and all, exactly once. */
export type Minted = components["schemas"]["Minted"];

/** Every agent token the vault holds. Never a digest and never a secret. */
export async function fetchTokens(): Promise<Token[]> {
  const { data, response } = await client.GET("/api/tokens");

  if (!data) {
    throw new Error(`GET /api/tokens failed with ${response.status}`);
  }

  return data;
}

/**
 * Mint one agent token and hand back the only copy of its secret.
 *
 * The refusal is put in front of the person who typed the name, the way a clip's
 * is: a taken name is the one failure here they can do something about.
 */
export async function createToken(name: string): Promise<Minted> {
  const { data, error, response } = await client.POST("/api/tokens", { body: { name } });

  if (!data) {
    throw new Error(reason(error) ?? `POST /api/tokens failed with ${response.status}`);
  }

  return data;
}

/** Revoke one agent token. The next request carrying it is refused. */
export async function revokeToken(name: string): Promise<void> {
  const { response } = await client.DELETE("/api/tokens/{name}", {
    params: { path: { name } },
  });

  if (!response.ok) {
    throw new Error(`DELETE /api/tokens/${name} failed with ${response.status}`);
  }
}
