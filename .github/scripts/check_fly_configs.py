#!/usr/bin/env python3
"""Guards for the Fly.io staging configs (forgepay/infra/fly/<service>/fly.toml).

- every config parses and names its app and the Stockholm region
- only the console is public: the bureau, gateway and compliance monitor must have no http_service or services
- nothing in [env] looks like a secret (secrets go in `fly secrets set`, never in the repository)
- every service the deploy workflow offers has a config, and every config is offered
"""
import pathlib, re, sys, tomllib

ROOT = pathlib.Path(__file__).resolve().parents[2]
FLY = ROOT / "forgepay/infra/fly"
PUBLIC = {"console"}
SECRET_NAME = re.compile(r"(SECRET|PASSWORD|PRIVATE_KEY|TOKEN|API_KEY|_KEYS?$|DATABASE_URL|REDIS_URL|RPC_URL|WEBHOOK_URL|HASHES)")
ALLOWED_ENV = {"KEY_WRAP_PROVIDER"}  # names that match the pattern but hold no secret


def check() -> list[str]:
    errors = []
    configs = sorted(FLY.glob("*/fly.toml"))
    if not configs:
        return [f"no fly.toml found under {FLY}"]
    for f in configs:
        svc = f.parent.name
        try:
            d = tomllib.loads(f.read_text())
        except tomllib.TOMLDecodeError as e:
            errors.append(f"{svc}: does not parse: {e}")
            continue
        if not d.get("app"):
            errors.append(f"{svc}: no app name")
        if d.get("primary_region") != "arn":
            errors.append(f"{svc}: primary_region must be arn (Stockholm), not {d.get('primary_region')!r}")
        public = "http_service" in d or "services" in d
        if public and svc not in PUBLIC:
            errors.append(f"{svc}: must be private, but defines http_service/services (a public address)")
        if not public and svc in PUBLIC:
            errors.append(f"{svc}: expected a public http_service")
        for k in d.get("env", {}):
            if SECRET_NAME.search(k) and k not in ALLOWED_ENV:
                errors.append(f"{svc}: [env] {k} looks like a secret; set it with `fly secrets set`, not in the file")
    wf = (ROOT / ".github/workflows/deploy-fly.yml").read_text()
    m = re.search(r"service:\n(?:.*\n)*?\s+options:\n((?:\s+- .+\n)+)", wf)
    offered = set(re.findall(r"- (\S+)", m.group(1))) if m else set()
    have = {c.parent.name for c in configs}
    if offered != have:
        errors.append(f"deploy-fly.yml offers {sorted(offered)} but configs exist for {sorted(have)}")
    return errors


if __name__ == "__main__":
    errs = check()
    for e in errs:
        print(f"::error::{e}")
    if not errs:
        print(f"fly configs ok: {len(list(FLY.glob('*/fly.toml')))} services, only {sorted(PUBLIC)} public, no secrets in [env]")
    sys.exit(1 if errs else 0)
