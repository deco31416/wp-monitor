#!/usr/bin/env bash
set -Eeuo pipefail

die() {
    printf 'browser startup error: %s\n' "$1" >&2
    exit 1
}

read_password() {
    if [[ -n "${BROWSER_VNC_PASSWORD_FILE:-}" ]]; then
        [[ "$BROWSER_VNC_PASSWORD_FILE" == /* ]] || die 'BROWSER_VNC_PASSWORD_FILE must be absolute'
        [[ -f "$BROWSER_VNC_PASSWORD_FILE" && ! -L "$BROWSER_VNC_PASSWORD_FILE" ]] \
            || die 'BROWSER_VNC_PASSWORD_FILE is missing or unsafe'
        tr -d '\r\n' <"$BROWSER_VNC_PASSWORD_FILE"
        return
    fi
    printf '%s' "${BROWSER_VNC_PASSWORD:-}"
}

vnc_password="$(read_password)"
(( ${#vnc_password} >= 15 )) || die 'browser VNC password must contain at least 15 characters'

umask 077
mkdir -p "$HOME" "$XDG_RUNTIME_DIR" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" /tmp/pulse /tmp/.X11-unix /tmp/fluxbox /home/browser/profile
chmod 700 "$XDG_RUNTIME_DIR" /tmp/pulse
chmod 1777 /tmp/.X11-unix

# Chromium leaves host/PID-specific Singleton symlinks after an unclean stop.
# Hold an independent advisory lock first so stale markers are removed only when
# no other WP MONITOR browser owns this profile volume.
exec 8>"/home/browser/profile/.wp-monitor-profile.lock"
flock -n 8 || die 'browser profile is already owned by another running container'
for singleton_marker in SingletonLock SingletonCookie SingletonSocket; do
    singleton_path="/home/browser/profile/$singleton_marker"
    if [[ -e "$singleton_path" || -L "$singleton_path" ]]; then
        [[ -f "$singleton_path" || -L "$singleton_path" || -S "$singleton_path" ]] \
            || die "unsafe Chromium singleton marker: $singleton_marker"
        rm -f -- "$singleton_path"
    fi
done

rm -f /tmp/pulse/native /tmp/pulse/pid
x11vnc -storepasswd "$vnc_password" /tmp/x11vnc.pass >/dev/null
unset vnc_password BROWSER_VNC_PASSWORD

child_pids=()
child_names=()
cleanup() {
    local exit_code=$?
    trap - EXIT INT TERM
    if ((${#child_pids[@]})); then
        kill -TERM "${child_pids[@]}" >/dev/null 2>&1 || true
        wait "${child_pids[@]}" >/dev/null 2>&1 || true
    fi
    rm -f /tmp/x11vnc.pass
    exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

Xvfb "$DISPLAY" -screen 0 "${BROWSER_SCREEN:-1440x900x24}" -nolisten tcp &
child_pids+=("$!")
child_names+=("Xvfb")

display_ready=false
for _attempt in {1..100}; do
    if xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
        display_ready=true
        break
    fi
    sleep 0.1
done
[[ "$display_ready" == true ]] || die 'virtual display did not become ready'

pulseaudio \
    --daemonize=no \
    --exit-idle-time=-1 \
    --high-priority=no \
    --realtime=no \
    --log-target=stderr \
    --load="module-native-protocol-unix socket=/tmp/pulse/native auth-anonymous=1" \
    --load="module-null-sink sink_name=wp_output sink_properties=device.description=WP_Output" \
    --no-cpu-limit \
    --system=false \
    -n &
child_pids+=("$!")
child_names+=("PulseAudio")
pulse_ready=false
for _attempt in {1..100}; do
    if [[ -S /tmp/pulse/native ]]; then
        pulse_ready=true
        break
    fi
    sleep 0.1
done
[[ "$pulse_ready" == true ]] || die 'PulseAudio did not become ready'

fluxbox -display "$DISPLAY" >/tmp/fluxbox/fluxbox.log 2>&1 &
child_pids+=("$!")
child_names+=("Fluxbox")

chromium \
    --user-data-dir=/home/browser/profile \
    --no-first-run \
    --disable-background-networking \
    --disable-component-update \
    --disable-default-apps \
    --disable-features=Translate \
    --disable-sync \
    --metrics-recording-only \
    --password-store=basic \
    --use-fake-ui-for-media-stream \
    --window-size=1440,900 \
    https://web.whatsapp.com/ >/tmp/chromium.log 2>&1 &
child_pids+=("$!")
child_names+=("Chromium")

x11vnc \
    -display "$DISPLAY" \
    -forever \
    -localhost \
    -no6 \
    -rfbport 5900 \
    -rfbauth /tmp/x11vnc.pass \
    -shared \
    -safer \
    -noxdamage \
    >/tmp/x11vnc.log 2>&1 &
child_pids+=("$!")
child_names+=("x11vnc")

websockify --web=/usr/share/novnc 7900 localhost:5900 >/tmp/novnc.log 2>&1 &
child_pids+=("$!")
child_names+=("noVNC websockify")

exited_pid=''
if wait -n -p exited_pid "${child_pids[@]}"; then
    exit_code=0
else
    exit_code=$?
fi
exited_name='unknown process'
for index in "${!child_pids[@]}"; do
    if [[ "${child_pids[$index]}" == "$exited_pid" ]]; then
        exited_name="${child_names[$index]}"
        break
    fi
done
case "$exited_name" in
    Chromium)
        tail -n 40 /tmp/chromium.log >&2 || true
        ;;
    PulseAudio)
        printf 'PulseAudio terminated before the browser service could remain ready.\n' >&2
        ;;
    x11vnc)
        tail -n 40 /tmp/x11vnc.log >&2 || true
        ;;
    "noVNC websockify")
        tail -n 40 /tmp/novnc.log >&2 || true
        ;;
esac
die "$exited_name exited unexpectedly with status $exit_code"
