#!/usr/bin/env bash
# docker compose file list: docker-compose.yml + compose/projects/*.yml (sorted).
# Source from deploy-safe.sh; no-op extra -f when there are no fragments.

zoto_compose_init() {
  local root="${1:?}"
  COMPOSE_FILE_ARGS=(-f "${root}/docker-compose.yml")
  if [[ -d "${root}/compose/projects" ]]; then
    local f
    shopt -s nullglob
    for f in "${root}/compose/projects/"*.yml; do
      COMPOSE_FILE_ARGS+=(-f "$f")
    done
    shopt -u nullglob
  fi
}

zoto_compose() {
  docker compose -p zoto-sites "${COMPOSE_FILE_ARGS[@]}" "$@"
}
