"""argparse dispatcher for the lemon CLI."""
import argparse
import json
import sys

from . import config
from .commands import (
    app_status,
    app_ls,
    secrets_status,
    caddy_routes,
    port_audit,
    deploy_check,
    docker_ls,
    bao_keys,
    smoke as smoke_cmd,
    auth_check,
    verify,
    server_health,
    logs as logs_cmd,
    gh_status,
    bao_status,
    backup_status,
    n8n_cmd,
    plane_cmd,
    ci_cmd,
)


def _emit(result, args, render_text=None) -> int:
    if args.text and render_text is not None:
        sys.stdout.write(render_text(result) + "\n")
    else:
        sys.stdout.write(json.dumps(result, indent=2 if args.pretty else None, default=str) + "\n")
    # Exit 2 on partial errors (when result is a dict carrying an 'errors' list with content)
    if isinstance(result, dict) and result.get("errors"):
        return 2
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="lemon",
        description="LLM-friendly composite reads of lemon-stack host state.",
    )
    p.add_argument("--text", action="store_true", help="Human-readable output (default: JSON).")
    p.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    p.add_argument("--debug", action="store_true", help="Log subprocess + HTTP calls to stderr.")
    p.add_argument("--no-bao", action="store_true", help="Skip OpenBao calls.")

    sub = p.add_subparsers(dest="cmd", required=True)

    # `lemon app ...`
    sp_app = sub.add_parser("app", help="App-level commands.")
    sp_app_sub = sp_app.add_subparsers(dest="app_cmd", required=True)
    sp_status = sp_app_sub.add_parser("status", help="Composite status for one app.")
    sp_status.add_argument("app")
    sp_status.set_defaults(_func=app_status.run, _render=app_status.render_text)
    sp_ls = sp_app_sub.add_parser("ls", help="List all known apps.")
    sp_ls.set_defaults(_func=app_ls.run, _render=app_ls.render_text)

    # `lemon secrets status <app>`
    sp_sec = sub.add_parser("secrets", help="Secrets queries.")
    sp_sec_sub = sp_sec.add_subparsers(dest="sec_cmd", required=True)
    sp_sec_status = sp_sec_sub.add_parser("status", help="Where do <app>'s secrets live?")
    sp_sec_status.add_argument("app")
    sp_sec_status.set_defaults(_func=secrets_status.run, _render=secrets_status.render_text)

    # `lemon caddy routes`
    sp_caddy = sub.add_parser("caddy", help="Caddy queries.")
    sp_caddy_sub = sp_caddy.add_subparsers(dest="caddy_cmd", required=True)
    sp_routes = sp_caddy_sub.add_parser("routes", help="All routes from Caddyfile.")
    sp_routes.set_defaults(_func=caddy_routes.run, _render=caddy_routes.render_text)

    # `lemon port-audit`
    sp_audit = sub.add_parser("port-audit", help="Cross-check ports/containers/Caddy.")
    sp_audit.set_defaults(_func=port_audit.run, _render=port_audit.render_text)

    # `lemon deploy-check <repo>`
    sp_dc = sub.add_parser("deploy-check", help="Pre-deploy sanity check.")
    sp_dc.add_argument("repo")
    sp_dc.set_defaults(_func=deploy_check.run, _render=deploy_check.render_text)

    # `lemon docker-ls`
    sp_dls = sub.add_parser("docker-ls", help="List ~/docker/ subdirs with managed-by hint.")
    sp_dls.set_defaults(_func=docker_ls.run, _render=docker_ls.render_text)

    # `lemon bao-keys <app>`
    sp_bk = sub.add_parser("bao-keys", help="List OpenBao keys for an app.")
    sp_bk.add_argument("app")
    sp_bk.set_defaults(_func=bao_keys.run, _render=bao_keys.render_text)

    # `lemon smoke <app|url>`
    sp_sm = sub.add_parser(
        "smoke",
        help="HTTP probe of <app>.<your domain> via Caddy on localhost (skips Cloudflare).",
    )
    sp_sm.add_argument("target", help="App name (e.g. food-splitter) or full URL.")
    sp_sm.add_argument("--no-follow", action="store_true", help="Don't follow redirects.")
    sp_sm.set_defaults(_func=smoke_cmd.run, _render=smoke_cmd.render_text)

    # `lemon auth-check <app>`
    sp_ac = sub.add_parser(
        "auth-check",
        help="Verify Authentik wiring: Caddy block, outpost reachable, anon challenged.",
    )
    sp_ac.add_argument("app")
    sp_ac.set_defaults(_func=auth_check.run, _render=auth_check.render_text)

    # `lemon verify <app>`
    sp_v = sub.add_parser(
        "verify",
        help="Composite gate before declaring an app done: container + caddy + HTTP + fresh logs.",
    )
    sp_v.add_argument("app")
    sp_v.add_argument(
        "--since", type=int, default=60,
        help="Window (seconds) for the no-fresh-errors check (default: 60).",
    )
    sp_v.set_defaults(_func=verify.run, _render=verify.render_text)

    # `lemon server-health`
    sp_sh = sub.add_parser(
        "server-health",
        help="Composite server health: containers, disk, failed units, tunnel, monitoring, runner.",
    )
    sp_sh.set_defaults(_func=server_health.run, _render=server_health.render_text)

    # `lemon logs <app>`
    sp_logs = sub.add_parser(
        "logs",
        help="Query Loki for recent app logs.",
    )
    sp_logs.add_argument("app", help="App name (matches loki_project or container label).")
    sp_logs.add_argument("--since", default="15m", help="Time window (e.g. 15m, 1h, 2h30m). Default: 15m.")
    sp_logs.add_argument("--limit", type=int, default=50, help="Max log lines to return. Default: 50.")
    sp_logs.add_argument("--errors", action="store_true", help="Filter to error/exception/fatal lines only.")
    sp_logs.set_defaults(_func=logs_cmd.run, _render=logs_cmd.render_text)

    # `lemon gh-status <repo>`
    sp_gh = sub.add_parser(
        "gh-status",
        help="Recent GitHub Actions runs for a repo in <your GitHub org>.",
    )
    sp_gh.add_argument("repo", help="Repo name (without org prefix).")
    sp_gh.add_argument("--limit", type=int, default=5, help="Number of runs to fetch. Default: 5.")
    sp_gh.set_defaults(_func=gh_status.run, _render=gh_status.render_text)

    # `lemon bao-status`
    sp_bs = sub.add_parser(
        "bao-status",
        help="OpenBao seal/health check and list of apps with AppRole credentials.",
    )
    sp_bs.set_defaults(_func=bao_status.run, _render=bao_status.render_text)

    # `lemon backup-status`
    sp_bkp = sub.add_parser(
        "backup-status",
        help="Last backup run status from ~/backup.log and latest restic snapshot.",
    )
    sp_bkp.add_argument("--no-restic", action="store_true", help="Skip restic snapshot query.")
    sp_bkp.set_defaults(_func=backup_status.run, _render=backup_status.render_text)

    # `lemon n8n ...`
    sp_n8n = sub.add_parser("n8n", help="n8n workflow queries.")
    sp_n8n_sub = sp_n8n.add_subparsers(dest="n8n_cmd", required=True)
    sp_n8n_ls = sp_n8n_sub.add_parser("ls", help="List all n8n workflows.")
    sp_n8n_ls.set_defaults(_func=n8n_cmd.run_ls, _render=n8n_cmd.render_ls_text)
    sp_n8n_st = sp_n8n_sub.add_parser("status", help="Get details for one workflow by ID or name.")
    sp_n8n_st.add_argument("workflow", help="Workflow ID or partial name.")
    sp_n8n_st.set_defaults(_func=n8n_cmd.run_status, _render=n8n_cmd.render_status_text)

    # `lemon ci ...`
    sp_ci = sub.add_parser("ci", help="CI pipeline status and warning analysis.")
    sp_ci_sub = sp_ci.add_subparsers(dest="ci_cmd", required=True)
    sp_ci_ls = sp_ci_sub.add_parser("ls", help="Latest run status for all org repos.")
    sp_ci_ls.set_defaults(_func=ci_cmd.run_ls, _render=ci_cmd.render_ls_text)
    sp_ci_check = sp_ci_sub.add_parser("check", help="Analyse latest run warnings for a repo.")
    sp_ci_check.add_argument("repo", help="Repo name (without org prefix).")
    sp_ci_check.set_defaults(_func=ci_cmd.run_repo, _render=ci_cmd.render_repo_text)

    # `lemon plane ...`
    sp_plane = sub.add_parser("plane", help="Plane project management queries.")
    sp_plane_sub = sp_plane.add_subparsers(dest="plane_cmd", required=True)
    sp_plane_ls = sp_plane_sub.add_parser("ls", help="List Plane issues.")
    sp_plane_ls.add_argument(
        "--state", default="open",
        help="State filter: open (default), backlog, todo, in-progress, done, cancelled.",
    )
    sp_plane_ls.set_defaults(_func=plane_cmd.run_ls, _render=plane_cmd.render_ls_text)

    return p


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    config.DEBUG = bool(getattr(args, "debug", False))
    config.NO_BAO = bool(getattr(args, "no_bao", False))

    func = getattr(args, "_func", None)
    render = getattr(args, "_render", None)
    if func is None:
        parser.print_help()
        return 1
    try:
        result = func(args)
    except KeyboardInterrupt:
        return 130
    except Exception as e:
        if config.DEBUG:
            import traceback
            traceback.print_exc()
        err = {"error": str(e), "type": type(e).__name__}
        sys.stdout.write(json.dumps(err) + "\n")
        return 1
    return _emit(result, args, render)


if __name__ == "__main__":
    sys.exit(main())
