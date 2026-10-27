import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** One agent token as the store may be read: a name, when it was made and when it last answered. */
export type TokenUse = components["schemas"]["TokenUse"];

/** One request a token made: when, what it asked for and what the vault answered. */
export type TokenAction = components["schemas"]["TokenActionRead"];

/** One agent token as it is handed over, secret and all, exactly once. */
export type Minted = components["schemas"]["Minted"];

/** Every agent token the vault holds. Never a digest and never a secret. */
export async function fetchTokens(): Promise<TokenUse[]> {
  const { data, response } = await client.GET("/api/tokens");

  if (!data) {
    throw new Error(`GET /api/tokens failed with ${response.status}`);
  }

  return data;
}

/** The newest requests one token made, at most 50, newest first. */
export async function fetchTokenActions(name: string): Promise<TokenAction[]> {
  const { data, response } = await client.GET("/api/tokens/{name}/actions", {
    params: { path: { name } },
  });

  if (!data) {
    throw new Error(`GET /api/tokens/${name}/actions failed with ${response.status}`);
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
