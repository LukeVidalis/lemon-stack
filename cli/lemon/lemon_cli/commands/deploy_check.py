"""Pre-deploy sanity check for a repo name."""
from ..sources import ports as p_src
from ..sources import caddy as c_src
from ..sources import filesystem as fs


def run(args) -> dict:
    repo = args.repo
    reasons: list[str] = []
    suggested_port = None

    declared = p_src.load()
    if repo in declared:
        reasons.append(f"port already assigned: {declared[repo]}")
    else:
        # Suggest next free port in the deploy range
        in_use = set()
        for entry in declared.values():
            in_use.update(p_src.flatten(entry))
        for p in range(10000, 11000):
            if p not in in_use:
                suggested_port = p
                break

    if c_src.for_app(repo):
        reasons.append(f"Caddy block already exists for {repo}.<your domain>")

    if fs.exists(repo):
        reasons.append(f"~/docker/{repo}/ already exists")

    ready = not reasons
    return {
        "repo": repo,
        "ready": ready,
        "reasons": reasons,
        "port_suggested": suggested_port,
    }


def render_text(r: dict) -> str:
    out = [
        f"repo:           {r['repo']}",
        f"ready:          {r['ready']}",
        f"port_suggested: {r['port_suggested']}",
    ]
    if r["reasons"]:
        out.append("reasons:")
        for x in r["reasons"]:
            out.append(f"  - {x}")
    return "\n".join(out)
