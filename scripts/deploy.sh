#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# deploy.sh — aidacore (Pi UI) 本地部署脚本
# 架构 (与 pi-ui 主干一致, core 仅允许 loopback):
#   core  -> 127.0.0.1:4174 (node bin/pi-ui.js start)
#   proxy -> 0.0.0.0:4173   (scripts/proxy-server.mjs)
# 用法:
#   ./scripts/deploy.sh            全量部署: 依赖 + 构建 + 默认模型配置 + 重启
#   ./scripts/deploy.sh init-config 安装默认模型配置 (仅当 .workspace 中不存在时)
#   ./scripts/deploy.sh start      仅启动 (不重新构建)
#   ./scripts/deploy.sh stop       停止 core 与 proxy
#   ./scripts/deploy.sh restart    停止后重新启动 (不重新构建)
#   ./scripts/deploy.sh status     查看进程与健康状态
# 环境变量:
#   PUBLIC_HOST    对外监听地址 (默认 0.0.0.0)
#   PUBLIC_PORT    对外监听端口 (默认 4173)
#   CORE_PORT      core 的 loopback 端口 (默认 4174)
#   PI_UI_THEME    主题 dark/zengrid/aida (默认 aida)
#   PI_UI_LANGUAGE 语言 en/zh-CN (默认 zh-CN)
# ═══════════════════════════════════════════════════════════
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE_HOST="${CORE_HOST:-127.0.0.1}"
CORE_PORT="${CORE_PORT:-4174}"
PUBLIC_HOST="${PUBLIC_HOST:-0.0.0.0}"
PUBLIC_PORT="${PUBLIC_PORT:-4173}"
PI_UI_THEME="${PI_UI_THEME:-aida}"
PI_UI_LANGUAGE="${PI_UI_LANGUAGE:-zh-CN}"
RUN_DIR="$REPO_ROOT/.workspace/run"
LOG_DIR="$REPO_ROOT/.workspace/logs"
CORE_PID_FILE="$RUN_DIR/pi-ui.pid"
PROXY_PID_FILE="$RUN_DIR/proxy.pid"

mkdir -p "$RUN_DIR" "$LOG_DIR"

log() { printf '[deploy] %s\n' "$*"; }

wait_health() {
  local url="$1" pid_file="$2" name="$3"
  local attempts=0
  while [ "$attempts" -lt 40 ]; do
    if ! kill -0 "$(cat "$pid_file" 2>/dev/null)" 2>/dev/null; then
      log "ERROR: $name exited during startup, see $LOG_DIR"
      return 1
    fi
    if curl -fsS -m 2 -o /dev/null "$url" 2>/dev/null; then
      log "$name is healthy ($url)"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.5
  done
  log "ERROR: $name did not become healthy in time"
  return 1
}

stop_service() {
  local pid_file="$1" name="$2"
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      log "stopping $name (pid $pid)"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.5
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

stop() {
  stop_service "$PROXY_PID_FILE" "proxy"
  stop_service "$CORE_PID_FILE" "pi-ui core"
  log "stopped"
}

health_url() {
  local host="$1" port="$2"
  case "$host" in
    0.0.0.0|::|127.0.0.1|localhost) printf 'http://127.0.0.1:%s/' "$port" ;;
    *) printf 'http://%s:%s/' "$host" "$port" ;;
  esac
}

start_core() {
  local host="$1" port="$2"
  if [ -f "$CORE_PID_FILE" ] && kill -0 "$(cat "$CORE_PID_FILE")" 2>/dev/null; then
    log "pi-ui core already running (pid $(cat "$CORE_PID_FILE"))"
  else
    log "starting pi-ui core (theme=$PI_UI_THEME) on $host:$port"
    cd "$REPO_ROOT"
    PI_UI_THEME="$PI_UI_THEME" PI_UI_LANGUAGE="$PI_UI_LANGUAGE" \
      setsid node bin/pi-ui.js start --host "$host" --port "$port" --no-open \
      >>"$LOG_DIR/pi-ui.log" 2>&1 < /dev/null &
    echo $! > "$CORE_PID_FILE"
    wait_health "$(health_url "$host" "$port")" "$CORE_PID_FILE" "pi-ui core"
  fi
}

start_proxy() {
  local host="$1" port="$2" upstream="$3"
  if [ -f "$PROXY_PID_FILE" ] && kill -0 "$(cat "$PROXY_PID_FILE")" 2>/dev/null; then
    log "proxy already running (pid $(cat "$PROXY_PID_FILE"))"
  else
    log "starting proxy on $host:$port -> $upstream"
    cd "$REPO_ROOT"
    setsid node scripts/proxy-server.mjs --port "$port" --upstream "$upstream" \
      >>"$LOG_DIR/proxy.log" 2>&1 < /dev/null &
    echo $! > "$PROXY_PID_FILE"
    wait_health "$(health_url "$host" "$port")" "$PROXY_PID_FILE" "proxy"
  fi
}

start() {
  start_core 127.0.0.1 "$CORE_PORT"
  start_proxy "$PUBLIC_HOST" "$PUBLIC_PORT" "http://127.0.0.1:$CORE_PORT"
}

init_config() {
  local agentcore="$REPO_ROOT/.workspace/.agentcore"
  local models_src="$REPO_ROOT/scripts/models.default.json"
  local active_src="$REPO_ROOT/scripts/active-model.default.json"
  mkdir -p "$agentcore"
  if [ ! -f "$agentcore/models.json" ]; then
    cp "$models_src" "$agentcore/models.json"
    log "installed default models config -> .workspace/.agentcore/models.json"
  else
    log "models config already exists, skipped"
  fi
  if [ ! -f "$agentcore/active-model.json" ]; then
    cp "$active_src" "$agentcore/active-model.json"
    log "installed default active model -> .workspace/.agentcore/active-model.json"
  else
    log "active-model config already exists, skipped"
  fi
}

deploy() {
  cd "$REPO_ROOT"
  log "installing dependencies"
  pnpm install --frozen-lockfile --prefer-offline || pnpm install
  log "building"
  pnpm build
  init_config
  stop
  start
  local server_ip
  server_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  log "deployed: http://${server_ip:-<server-ip>}:$PUBLIC_PORT/"
}

status() {
  log "repo: $REPO_ROOT"
  for entry in "$CORE_PID_FILE:pi-ui core" "$PROXY_PID_FILE:proxy"; do
    local pid_file="${entry%%:*}" name="${entry#*:}"
    if [ -f "$pid_file" ]; then
      local pid
      pid="$(cat "$pid_file")"
      if kill -0 "$pid" 2>/dev/null; then
        log "$name: running (pid $pid)"
      else
        log "$name: stale pid file ($pid)"
      fi
    else
      log "$name: not running"
    fi
  done
  log "listeners:"
  ss -tlnp 2>/dev/null | grep -E ":(4173|4174)\b" || true
  log "health:"
  curl -s -o /dev/null -w "  core   http://127.0.0.1:$CORE_PORT/ -> %{http_code}\n" "http://127.0.0.1:$CORE_PORT/" || true
  curl -s -o /dev/null -w "  public http://127.0.0.1:$PUBLIC_PORT/ -> %{http_code}\n" "http://127.0.0.1:$PUBLIC_PORT/" || true
}

case "${1:-deploy}" in
  init-config) init_config ;;
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status) status ;;
  deploy) deploy ;;
  *) echo "用法: $0 [deploy|start|stop|restart|status]"; exit 1 ;;
esac
