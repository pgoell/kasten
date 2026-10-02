# deploy

`compose.yaml` and `.env.prod.example` for production. `selfhost/` is the
whole stack for one machine of your own. The dev compose files are at the repo
root.

The runbook moved into the docs bundle, where the Diátaxis split can hold it:

* [Deploy to the VPS](../docs/how-to/deploy-to-the-vps.md): bootstrap, day to day, rollback, and proving the shell is still behind its gate
* [Two environments](../docs/explanation/environments.md): why dev and prod are built in opposite ways, and the six constraints this box imposes
* [Self-host kasten](../docs/how-to/self-host-kasten.md): `selfhost/`, with its own Caddy and a choice of three login gates
