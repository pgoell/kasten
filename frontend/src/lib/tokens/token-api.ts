import { client, reason } from "@/lib/api-client";
import type { components } from "@/lib/api-types";

/** An agent token as the vault lists it: its name, creation time and last use. */
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
 * Mints one agent token and returns its only copy of the secret. The refusal reason is shown
 * to the typist: a taken name is the one failure they can fix.
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
