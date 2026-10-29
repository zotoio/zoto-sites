#!/usr/bin/env bash
# Per-service master keys for data at rest (security D3, approved 2026-10-29).
#
#   sudo scripts/botz-keys.sh init     <botz-mcp|swarm>   create /etc/botz/keys/<svc>.env (refuses if present)
#   sudo scripts/botz-keys.sh add-key  <botz-mcp|swarm>   prepend a NEW active key id (old ids stay readable)
#   sudo scripts/botz-keys.sh drop-key <botz-mcp|swarm> <kid>  remove a retired, non-active key id
#   sudo scripts/botz-keys.sh status   [botz-mcp|swarm]   key ids, active id, owner/mode (never values)
#
# File: root:root 0400 in root:root 0700 /etc/botz/keys, loaded by compose env_file.
#   <P>_STORAGE_KEYS=<kid>:<base64url 32 bytes>[,<older kid>:<key>...]   first = active (AES-256-GCM)
#   <P>_STORAGE_HASH_PEPPER=<base64url 32 bytes>                         HMAC-SHA256 pepper (never rotate
#                                                                         casually: in-flight swarm OAuth
#                                                                         refresh tokens are looked up by it)
# P = BOTZ (botz-mcp) or SWARM (swarm). Keys come from Python's `secrets` (OS CSPRNG).
# Every change first copies the key file to <file>.bak-<ts> (0400 root). Nothing is ever printed
# except key ids, paths and permissions.
set -euo pipefail
umask 077
[[ $EUID -eq 0 ]] || { echo "botz-keys: run as root" >&2; exit 2; }
DIR="${BOTZ_KEYS_DIR:-/etc/botz/keys}"
CMD="${1:?usage: botz-keys.sh init|add-key|drop-key|status <service>}"
SVC="${2:-}"

prefix() {
  case "$1" in
    botz-mcp) echo BOTZ ;;
    swarm) echo SWARM ;;
    *) echo "botz-keys: unknown service '$1' (botz-mcp|swarm)" >&2; exit 2 ;;
  esac
}
rand() { python3 -c 'import secrets; print(secrets.token_urlsafe(32))'; }
newkid() { echo "k$(date -u +%Y%m%d)-$(python3 -c 'import secrets; print(secrets.token_hex(3))')"; }
getvar() { sed -n "s/^$2=//p" "$1" | tail -1; }
backup() { local b; b="$1.bak-$(date -u +%Y%m%dT%H%M%SZ)"; [[ -e "$b" ]] && b="$b-$$"; cp -p "$1" "$b"; chown root:root "$b"; chmod 0400 "$b"; echo "botz-keys: backup $b"; }
write() { # file content: atomic, 0400 root
  local tmp; tmp="$(mktemp "$DIR/.tmp.XXXXXX")"; printf '%s\n' "$2" > "$tmp"
  chown root:root "$tmp"; chmod 0400 "$tmp"; mv -f "$tmp" "$1"
}
kids_of() { getvar "$1" "$2_STORAGE_KEYS" | tr ',' '\n' | sed 's/:.*//' | paste -sd, -; }

ensure_dir() { install -d -o root -g root -m 0700 "$(dirname "$DIR")" "$DIR"; chmod 0755 "$(dirname "$DIR")"; }

case "$CMD" in
  init)
    P="$(prefix "$SVC")"; F="$DIR/$SVC.env"; ensure_dir
    [[ -e "$F" ]] && { echo "botz-keys: $F exists; refusing to overwrite (use add-key to rotate)" >&2; exit 1; }
    write "$F" "# $SVC master keys (security D3). Generated $(date -u +%FT%TZ) on $(hostname). Root-only; never commit.
${P}_STORAGE_KEYS=$(newkid):$(rand)
${P}_STORAGE_HASH_PEPPER=$(rand)"
    echo "botz-keys: created $F (active $(kids_of "$F" "$P"))" ;;
  add-key)
    P="$(prefix "$SVC")"; F="$DIR/$SVC.env"; [[ -f "$F" ]] || { echo "botz-keys: $F missing; run init" >&2; exit 1; }
    backup "$F"; cur="$(getvar "$F" "${P}_STORAGE_KEYS")"; kid="$(newkid)"
    content="$(grep -v "^${P}_STORAGE_KEYS=" "$F")
${P}_STORAGE_KEYS=${kid}:$(rand),${cur}"
    write "$F" "$content"; echo "botz-keys: $F active key is now $kid (all: $(kids_of "$F" "$P"))" ;;
  drop-key)
    P="$(prefix "$SVC")"; F="$DIR/$SVC.env"; KID="${3:?kid}"
    cur="$(getvar "$F" "${P}_STORAGE_KEYS")"; active="${cur%%:*}"
    [[ "$KID" == "$active" ]] && { echo "botz-keys: refusing to drop the active key $KID" >&2; exit 1; }
    next="$(tr ',' '\n' <<<"$cur" | grep -v "^${KID}:" | paste -sd, -)"
    [[ "$next" == "$cur" ]] && { echo "botz-keys: key id $KID not present" >&2; exit 1; }
    backup "$F"; write "$F" "$(grep -v "^${P}_STORAGE_KEYS=" "$F")
${P}_STORAGE_KEYS=${next}"
    echo "botz-keys: dropped $KID from $F (now: $(kids_of "$F" "$P"))" ;;
  status)
    for s in ${SVC:-botz-mcp swarm}; do
      P="$(prefix "$s")"; F="$DIR/$s.env"
      if [[ -f "$F" ]]; then
        echo "$F $(stat -c '%U:%G %a' "$F") kids=$(kids_of "$F" "$P") active=$(kids_of "$F" "$P" | cut -d, -f1) pepper=$([[ -n "$(getvar "$F" "${P}_STORAGE_HASH_PEPPER")" ]] && echo yes || echo no)"
      else echo "$F missing"; fi
    done
    echo "$DIR $(stat -c '%U:%G %a' "$DIR" 2>/dev/null || echo missing)" ;;
  *) echo "botz-keys: unknown command $CMD" >&2; exit 2 ;;
esac
