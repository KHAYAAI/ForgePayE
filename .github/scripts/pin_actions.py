#!/usr/bin/env python3
"""Pin third-party GitHub Actions to the commit they currently point at.

A tag such as `actions/checkout@v4` is moved by whoever controls that repository. A compromised or hijacked action would then run, with our
secrets and deploy credentials, in the next job that uses it. A 40-character commit SHA cannot be moved. Dependabot (see dependabot.yml)
keeps pinned actions current and keeps the `# vX` comment, so the cost is a weekly pull request.

  python3 .github/scripts/pin_actions.py            rewrite every unpinned `uses:` in our workflows to `@<sha> # <ref>`
  python3 .github/scripts/pin_actions.py --check    change nothing; exit 1 and list any `uses:` that is not pinned (run in CI)

Our workflows are forgepay-*.yml and deploy-service.yml. The inherited upstream workflows are not ours to rewrite.
Tags are resolved with `git ls-remote` on the public repository (a peeled annotated tag points at the commit, not the tag object).
Local actions (./...) and docker:// references are left alone.
"""
import glob
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHA = re.compile(r"^[0-9a-f]{40}$")
USES = re.compile(r"^(?P<head>\s*(?:-\s+)?uses:\s*)(?P<action>[A-Za-z0-9._-]+/[A-Za-z0-9._/-]+)@(?P<ref>[^\s#]+)(?P<tail>\s*#.*)?\s*$")


def our_workflows():
    wf = os.path.join(ROOT, ".github", "workflows")
    files = set(glob.glob(os.path.join(wf, "forgepay-*.yml"))) | {os.path.join(wf, "deploy-service.yml")}
    return sorted(f for f in files if os.path.exists(f))


def parse(line):
    """The parts of a `uses:` line, or None if it is not a pinnable reference."""
    m = USES.match(line.rstrip("\n"))
    if not m:
        return None
    return m.groupdict()


def is_pinned(ref):
    return bool(SHA.match(ref))


def repo_of(action):
    return "/".join(action.split("/")[:2])


def resolve(action, ref, runner=subprocess.run):
    """The commit SHA that `ref` (a tag, else a branch) of the action's repository points at."""
    url = f"https://github.com/{repo_of(action)}"
    out = runner(["git", "ls-remote", url, f"refs/tags/{ref}", f"refs/tags/{ref}^{{}}", f"refs/heads/{ref}"],
                 capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError(f"could not reach {url}: {out.stderr.strip()[:120]}")
    found = {}
    for row in out.stdout.splitlines():
        sha, _, name = row.partition("\t")
        found[name] = sha
    for name in (f"refs/tags/{ref}^{{}}", f"refs/tags/{ref}", f"refs/heads/{ref}"):
        if name in found and SHA.match(found[name]):
            return found[name]
    raise RuntimeError(f"{url} has no tag or branch named {ref}")


def rewrite(lines, resolver):
    """Return (new_lines, changes) with every unpinned reference pinned."""
    cache, changes, out = {}, [], []
    for line in lines:
        p = parse(line)
        if not p or is_pinned(p["ref"]):
            out.append(line)
            continue
        key = (repo_of(p["action"]), p["ref"])
        if key not in cache:
            cache[key] = resolver(p["action"], p["ref"])
        sha = cache[key]
        out.append(f'{p["head"]}{p["action"]}@{sha} # {p["ref"]}\n')
        changes.append((p["action"], p["ref"], sha))
    return out, changes


def unpinned(lines):
    return [(i + 1, parse(l)) for i, l in enumerate(lines) if parse(l) and not is_pinned(parse(l)["ref"])]


def main(argv):
    check = "--check" in argv
    bad = 0
    for path in our_workflows():
        with open(path) as f:
            lines = f.readlines()
        rel = os.path.relpath(path, ROOT)
        if check:
            for n, p in unpinned(lines):
                print(f"{rel}:{n}: {p['action']}@{p['ref']} is not pinned to a commit SHA")
                bad += 1
            continue
        new, changes = rewrite(lines, resolve)
        if changes:
            with open(path, "w") as f:
                f.writelines(new)
            for action, ref, sha in changes:
                print(f"{rel}: {action}@{ref} -> {sha[:12]}")
    if check and bad:
        print(f"\n{bad} reference(s) not pinned. Run: python3 .github/scripts/pin_actions.py")
        return 1
    if check:
        print("all third-party actions in our workflows are pinned to commit SHAs")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
