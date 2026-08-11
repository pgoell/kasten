---
okf_version: "0.2"
---

# kasten documentation

Documentation for kasten, a self-hosted markdown notebook. The pages are split
the way [Diátaxis](https://diataxis.fr) splits them, and the files follow the
[Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
v0.2, so an agent can walk this directory without being told how.

Each page carries a `type` in its frontmatter, and that type is the Diátaxis
quadrant: `Tutorial`, `How-to Guide`, `Reference` or `Explanation`. Read the
quadrant that fits what you are doing. Learning comes first, doing comes
second, looking things up comes third, understanding comes last.

## Quadrants

* [Tutorials](/tutorials/index.md) - lessons that take you from nothing to a running notebook
* [How-to guides](/how-to/index.md) - recipes for a job you already know you need
* [Reference](/reference/index.md) - the commands, endpoints and settings, stated plainly
* [Explanation](/explanation/index.md) - why kasten is built the way it is

## Elsewhere

* [README](../README.md) - what kasten is, in a paragraph
* [deploy/](../deploy/README.md) - the prod compose file, with the runbook itself in [Deploy to the VPS](/how-to/deploy-to-the-vps.md)
* [log.md](/log.md) - what changed in this bundle, by date
