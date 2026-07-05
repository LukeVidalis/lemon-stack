"""List ~/docker/ subdirs with managed-by hint."""
from ..sources import filesystem as fs
from ..sources import ports as p_src


def run(args) -> list[dict]:
    declared = set(p_src.load().keys())
    rows: list[dict] = []
    for d in fs.list_app_dirs():
        compose = fs.has_compose(d)
        dockerfile = fs.has_dockerfile(d)
        managed = "pipeline" if d in declared else "manual"
        rows.append({
            "dir": d,
            "has_compose": compose,
            "has_dockerfile": dockerfile,
            "managed_by": managed,
        })
    return rows


def render_text(rows: list[dict]) -> str:
    out = [f"{'DIR':<28} {'COMPOSE':<8} {'DOCKERFILE':<11} MANAGED", "-" * 60]
    for r in rows:
        out.append(
            f"{r['dir']:<28} {str(r['has_compose']):<8} {str(r['has_dockerfile']):<11} {r['managed_by']}"
        )
    return "\n".join(out)
