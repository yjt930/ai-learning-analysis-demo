#!/bin/zsh
cd "$(dirname "$0")"
echo "正在启动 PRD 本机推送服务..."
echo "保持这个窗口打开，然后在页面里点 PRD 面板的“推送”。"
/Users/yangjintian/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/prd-local-push-server.mjs
