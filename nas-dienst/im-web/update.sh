#!/bin/sh
# im-web v1.1 – holt den neuesten Stand der IM-Programme von GitHub.
# Ist GitHub nicht erreichbar, bleibt der zuletzt geholte Stand unverändert und wird weiter ausgeliefert.
ZIEL=/programme/lohnarbeit-planer
STAND=/programme/nas-stand.json
REPO=${REPO:-https://github.com/andind/lohnarbeit-planer.git}
BRANCH=${BRANCH:-main}
INTERVALL=${INTERVALL:-900}

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

stand() { # $1 = ok | fehler
  [ -d "$ZIEL/.git" ] || return 0
  c=$(git -C "$ZIEL" log -1 --format='%h' 2>/dev/null)
  d=$(git -C "$ZIEL" log -1 --format='%ci' 2>/dev/null)
  m=$(git -C "$ZIEL" log -1 --format='%s' 2>/dev/null | sed 's/\\/\\\\/g; s/"/\\"/g')
  printf '{"version":"im-web 1.1","commit":"%s","commitDatum":"%s","commitText":"%s","geprueft":"%s","github":"%s"}\n' \
    "$c" "$d" "$m" "$(date '+%Y-%m-%d %H:%M:%S')" "$1" > "$STAND.tmp" && mv "$STAND.tmp" "$STAND"
}

log "im-web-update v1.1 gestartet (Prüfung alle ${INTERVALL} s)"
while true; do
  if [ -d "$ZIEL/.git" ]; then
    if git -C "$ZIEL" fetch -q --depth 1 origin "$BRANCH" 2>/dev/null; then
      ALT=$(git -C "$ZIEL" rev-parse HEAD)
      NEU=$(git -C "$ZIEL" rev-parse FETCH_HEAD)
      if [ "$ALT" != "$NEU" ]; then
        git -C "$ZIEL" reset -q --hard FETCH_HEAD \
          && git -C "$ZIEL" reflog expire --expire=now --all \
          && git -C "$ZIEL" gc -q --prune=now
        log "aktualisiert: $(git -C "$ZIEL" log -1 --format='%h %s')"
      fi
      stand ok
    else
      log "GitHub nicht erreichbar – bisheriger Stand bleibt"
      stand fehler
    fi
  else
    log "erste Kopie wird geholt …"
    rm -rf "$ZIEL.neu"
    if git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$ZIEL.neu"; then
      mv "$ZIEL.neu" "$ZIEL"
      log "erste Kopie fertig: $(git -C "$ZIEL" log -1 --format='%h %s')"
      stand ok
    else
      rm -rf "$ZIEL.neu"
      log "GitHub nicht erreichbar – neuer Versuch in ${INTERVALL} s"
    fi
  fi
  sleep "$INTERVALL"
done
