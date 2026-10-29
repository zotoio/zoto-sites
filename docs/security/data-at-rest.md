# Data at rest: master keys, encryption, rotation, backup and recovery

Security decisions D3, D4 and D6 (approved by Andrew 2026-10-29). Applies to the production
host 170.64.250.36 (`/home/andrewv/git/zoto-sites`).

## Key files (D3)

| Service | Key file (host) | Variables | Loaded by |
| --- | --- | --- | --- |
| botz-mcp (mcp.botz.ai) | `/etc/botz/keys/botz-mcp.env` | `BOTZ_STORAGE_KEYS`, `BOTZ_STORAGE_HASH_PEPPER` | `compose/projects/botz-mcp.yml` `env_file` |
| swarm (swarm.botz.ai) | `/etc/botz/keys/swarm.env` | `SWARM_STORAGE_KEYS`, `SWARM_STORAGE_HASH_PEPPER` | `compose/projects/swarm.yml` `env_file` |

* `/etc/botz/keys` is `root:root 0700`; each key file is `root:root 0400`. Never commit or paste them anywhere but the password manager.
* Generated on the host with `sudo scripts/botz-keys.sh init <svc>` from Python `secrets` (OS CSPRNG): 32-byte AES-256 keys and a 32-byte HMAC pepper, base64url.
* `<P>_STORAGE_KEYS=<kid>:<key>[,<older kid>:<key>…]`. The **first** id is active for writes; every listed id is accepted for reads.
* Compose reads the file as the user running `docker compose`, so deploys must run as root (`sudo scripts/deploy-backend.sh …`). A non-root compose fails closed ("env file not found") instead of starting without keys.
* Inside the container the values are environment variables (visible to `docker inspect` for root/docker-group users on the host). That is the trust boundary: anyone with root or docker on the host can read them.

## What is protected

| Store | Location (host) | Protection |
| --- | --- | --- |
| botz-mcp OAuth store (FastMCP OAuth proxy: DCR clients, upstream GitHub tokens, JTI maps, refresh-token metadata, transactions, auth codes) | `backends/mcp/data/oauth-proxy/cache.db` | Values AES-256-GCM with the keyring (own key, D4; replaces the key derived from `BOTZ_MCP_JWT_SIGNING_KEY`). Authorization-code keys stored as HMAC-SHA256(pepper) (D6). Refresh tokens are stored by FastMCP only as SHA-256 hashes (never the token). |
| botz-mcp Swarm bridge API key | `backends/mcp/data/swarm_instrumentation.json` field `swarm_api_key` | Field-level AES-256-GCM (`enc:v1:…`). |
| botz-mcp IAM API tokens / console client tokens | `backends/mcp/data/state/iam.json` | Already SHA-256 hashes only. Provider keys and webhook secrets are env-only (`backends/mcp/.env`), never written to the data dir. |
| swarm OAuth server state (DCR clients, auth codes, refresh tokens) | `backends/swarm/data/mcp-swarm/data/oauth_state.json` | Whole file AES-256-GCM envelope; codes and refresh tokens stored only as HMAC-SHA256(pepper) hashes (D6). |
| swarm pending OAuth states | `…/data/oauth-pending.json` | Envelope; states stored as HMAC hashes. |
| swarm dashboard sessions (upstream GitHub token) | `…/data/sessions/*.json` | Envelope (file names were already SHA-256 of the session token). |
| swarm IAM / worker tokens | `…/data/iam-tokens.json` | Already SHA-256 hashes only. |

Not yet covered (follow-up, documented risk): swarm MCP *target* credentials (`target.auth.apiKey` in `policy.json`, `catalogue/*.json`, `projects/*/project.json`). They are read by many code paths that another change is editing concurrently, so they were left in place rather than risk breaking target calls; as an interim control `backends/swarm` was tightened to `0700 andrewv` on 2026-10-29 (it was `0755`; `backends/mcp` was already `0700`), so only root and `andrewv` (uid 1000, the container's `node` user) can read them.

Format: AES-256-GCM, 96-bit random nonce, 128-bit tag, key id stored with every ciphertext, AAD binds the
purpose (file/field), so a ciphertext cannot be swapped between files. Writes are atomic (temp file + rename).

## Migration (done 2026-10-29)

1. `sudo scripts/backup-data.sh <svc>` — every data file copied in place to `<file>.bak-<ts>` (`root:root 0400`; SQLite via the online backup API). Nothing is deleted.
2. Deploy the new code (`sudo scripts/deploy-backend.sh <svc> <dir>`). Readers accept both formats (botz-mcp still reads the old JWT-derived Fernet values; swarm reads plaintext JSON), so nothing breaks before re-encryption.
3. `sudo scripts/rotate-storage-key.sh <svc> --migrate-only` — backup again, then rewrite everything with the active key; legacy raw codes/refresh tokens/states become hashes; the SQLite file is VACUUMed so freed pages keep no old raw keys.

Existing sessions keep working: botz-mcp refresh tokens and OAuth clients are re-encrypted (same JWT signing key, same SHA-256 refresh-token index); swarm refresh tokens are converted to hashes and still match. No re-login was needed.

## Rotation runbook

```bash
cd /home/andrewv/git/zoto-sites
sudo scripts/rotate-storage-key.sh botz-mcp --dry-run     # throwaway key, report only, writes nothing
sudo scripts/rotate-storage-key.sh botz-mcp               # backup, add-key, reload, re-encrypt, health
sudo scripts/rotate-storage-key.sh swarm --dry-run
sudo scripts/rotate-storage-key.sh swarm                  # swarm is stopped while re-encrypting (seconds)
sudo scripts/botz-keys.sh status                          # key ids, active id, perms (never values)
```

Then **save the new key file in the password manager** (below). After at least one full backup cycle
confirms the old id is unused (`status`/dry-run shows every entry on the new id), retire it:
`sudo scripts/botz-keys.sh drop-key <svc> <old-kid>` and recreate the service.
Do not change `<P>_STORAGE_HASH_PEPPER` casually: swarm refresh tokens and pending codes are looked up by
it, so a new pepper means a one-time re-login for swarm OAuth clients (botz-mcp is unaffected: FastMCP
indexes refresh tokens by plain SHA-256; only 5-minute auth codes use the pepper).

Remove a swarm DCR client: `sudo scripts/rotate-storage-key.sh swarm --migrate-only --remove-client <client_id>`.

## Backup and recovery

* Data backups: `<file>.bak-<ts>` beside each file, `root:root 0400`. They hold the **pre-migration** format (the 2026-10-29 pre-migration copies contain the legacy plaintext swarm session token / Fernet store); delete them yourself once you no longer need a rollback point — automation never deletes them.
* Key backups: `botz-keys.sh` copies the key file to `/etc/botz/keys/<svc>.env.bak-<ts>` before any change.
* Lost key file = encrypted data unreadable. Recovery: restore the key file from the password manager (`sudo install -o root -g root -m 0400 /dev/stdin /etc/botz/keys/<svc>.env` and paste), then `sudo scripts/deploy-backend.sh` or recreate the service.
* Roll back to pre-encryption code: restore the matching `.bak-<ts>` data files (stop the service first), then deploy the previous source (`backends/<src>.prev-<ts>`). Never run old code on encrypted data: swarm would treat the sealed `oauth_state.json` as empty.
* If no backup of a key exists at all: botz-mcp users re-authorize Cursor (DCR + GitHub login); swarm users sign in again; IAM API tokens are unaffected (hashes).

## Andrew: save an offline copy of each key file (do this now and after every rotation)

For each of `botz-mcp` and `swarm`:

1. SSH to the host as your sudo user (e.g. `ssh zotoboss@170.64.250.36`).
2. Run `sudo cat /etc/botz/keys/botz-mcp.env` (then `swarm.env`). This only shows it in your own terminal.
3. In the password manager create a Secure Note named **"botz data-at-rest keys: botz-mcp (170.64.250.36)"** (and one for swarm). Paste the whole file (all lines). Add the path `/etc/botz/keys/<svc>.env`, today's date, and the active key id from `sudo scripts/botz-keys.sh status`.
4. Run `sudo sha256sum /etc/botz/keys/<svc>.env` and put the checksum in the note, so later you can confirm the saved copy matches.
5. Clear the terminal (`clear`) and close the SSH session. Don't paste the values into chat, email, tickets or git.
