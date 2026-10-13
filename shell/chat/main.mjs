/**
 * The runner as the shell container starts it: the real SDK, the vault, one port.
 *
 * The entrypoint copies this file and `runner.mjs` into `~/.kasten-chat`, where
 * the SDK is installed, and runs it from there. That is what lets the import
 * below be a plain one: node resolves a package from the directories above the
 * file that asks, and the SDK cannot live in the image. See shell/Dockerfile.
 */
import { createServer } from "node:http";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { createChat } from "./runner.mjs";

// The `claude` the terminal pane runs, handed over by the entrypoint. One
// install and one login for both, rather than the copy the SDK would bring.
const [claudePath] = process.argv.slice(2);

// Every interface, because Caddy reaches this over the docker network by the
// container's name. No port is published, the way none is for ttyd.
createServer(createChat({ query, claudePath, cwd: "/vault" }).handle).listen(7682, "0.0.0.0");
