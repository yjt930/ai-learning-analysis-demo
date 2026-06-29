#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const htmlPath = join(root, '飞象星球.html');
const port = Number(process.env.PRD_PUSH_PORT || 18790);

const prdDocs = {
  'entry-panel': 'fx-prd-template-entry-panel',
  'welcome-quick': 'fx-prd-template-welcome-quick',
  'input-messages': 'fx-prd-template-input-messages',
  scope: 'fx-prd-template-scope',
  prompt: 'fx-prd-template-prompt',
  'reply-view': 'fx-prd-template-reply-view',
  'reply-tools': 'fx-prd-template-reply-tools',
  helpers: 'fx-prd-template-helpers',
  'analysis-cards': 'fx-prd-template-analysis-cards',
  'mobile-display': 'fx-prd-template-mobile-display'
};

function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, maxBuffer: 1024 * 1024 * 20 }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceTemplate(source, templateId, innerHtml) {
  const re = new RegExp(`(<template\\s+id=["']${escapeRegExp(templateId)}["'][^>]*>)([\\s\\S]*?)(\\n\\s*</template>)`);
  if (!re.test(source)) {
    throw new Error(`未找到模板：${templateId}`);
  }
  return source.replace(re, (_match, open, _oldInner, close) => `${open}\n${String(innerHtml).trim()}${close}`);
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10 * 1024 * 1024) {
      throw new Error('请求内容过大');
    }
  }
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

async function handlePush(req, res) {
  const body = await readJson(req);
  const drafts = body && body.drafts && typeof body.drafts === 'object' ? body.drafts : {};
  const changedDocIds = Object.keys(drafts).filter((docId) => prdDocs[docId] && typeof drafts[docId] === 'string');

  if (changedDocIds.length) {
    let source = await readFile(htmlPath, 'utf8');
    for (const docId of changedDocIds) {
      source = replaceTemplate(source, prdDocs[docId], drafts[docId]);
    }
    await writeFile(htmlPath, source);
  }

  await runGit(['add', '-A']);
  const staged = (await runGit(['diff', '--cached', '--name-only'])).stdout.trim();
  if (!staged) {
    sendJson(res, 200, { ok: true, skipped: true, message: '没有需要推送的项目改动。' });
    return;
  }

  const message = typeof body.message === 'string' && body.message.trim()
    ? body.message.trim()
    : 'Update project from PRD editor';

  await runGit(['commit', '-m', message]);
  await runGit(['pull', '--rebase', 'origin', 'main']);
  await runGit(['push', 'origin', 'main']);
  const head = (await runGit(['rev-parse', '--short', 'HEAD'])).stdout.trim();

  sendJson(res, 200, {
    ok: true,
    commit: head,
    files: staged.split('\n').filter(Boolean),
    message: `已推送整个项目：${head}`
  });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      sendJson(res, 204, {});
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, { ok: true, project: 'ai-learning-analysis-demo' });
      return;
    }
    if (req.method === 'POST' && req.url === '/push-prd') {
      await handlePush(req, res);
      return;
    }
    sendJson(res, 404, { ok: false, message: '接口不存在' });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      message: error.message || '推送失败',
      detail: [error.stderr, error.stdout].filter(Boolean).join('\n').trim()
    });
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`PRD 本机推送服务已启动：http://127.0.0.1:${port}`);
  console.log('保持这个窗口打开，然后在页面里点 PRD 面板的“推送”。');
});
