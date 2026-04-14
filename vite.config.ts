import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv, type Plugin } from 'vite';

type BuildInfo = {
  buildId: string;
  builtAt: string;
};

const REQUIRED_REMOTE_BUILD_ENV_KEYS = [
  'VITE_CSYOS_BACKEND_URL',
  'VITE_CSYOS_BACKEND_TOKEN',
] as const;

function createBuildInfo(): BuildInfo {
  const builtAt = new Date().toISOString();
  const buildId =
    process.env.CF_PAGES_COMMIT_SHA?.slice(0, 12) ||
    process.env.GITHUB_SHA?.slice(0, 12) ||
    `${builtAt.replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8)}`;

  return { buildId, builtAt };
}

function assertRequiredBuildEnv(mode: string, env: Record<string, string>) {
  if (!['staging', 'production'].includes(mode)) {
    return;
  }

  const missingKeys = REQUIRED_REMOTE_BUILD_ENV_KEYS.filter((key) => {
    const value = env[key];
    return !value || /replace-me|<your-|<set-/i.test(value);
  });

  if (missingKeys.length === 0) {
    return;
  }

  const envHint =
    mode === 'production'
      ? '.env.production.local or Cloudflare Pages production variables'
      : '.env.staging.local or Cloudflare Pages preview variables';

  throw new Error(
    `[build env] Missing required ${mode} variables: ${missingKeys.join(', ')}. ` +
      `Set them in ${envHint}. Automatic Pages builds cannot read your local .env files.`,
  );
}

function buildInfoPlugin(info: BuildInfo): Plugin {
  const body = `${JSON.stringify(info, null, 2)}\n`;

  return {
    name: 'sully-build-info',
    configureServer(server) {
      server.middlewares.use('/build-info.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'build-info.json',
        source: body,
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const buildInfo = createBuildInfo();

  if (command === 'build') {
    assertRequiredBuildEnv(mode, env);
  }

  return {
    plugins: [react() as any, buildInfoPlugin(buildInfo)],
    optimizeDeps: {
      exclude: ['onnxruntime-web'],
    },
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildInfo.buildId),
    },
    server: {
      proxy: {
        '/minimax-api': {
          target: 'https://api.minimaxi.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/minimax-api/, ''),
        },
        // XHS Bridge 模式 (xiaohongshu-skills REST server)
        '/xhs-api': {
          target: 'http://localhost:18061',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/xhs-api/, '/api'),
        },
        // XHS MCP 模式 (xiaohongshu-mcp Go server)
        '/xhs-mcp': {
          target: 'http://localhost:18060',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/xhs-mcp/, '/mcp'),
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['access-control-expose-headers'] = 'Mcp-Session-Id';
            });
          },
        },
      },
    },
    base: './',
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './test/setup.ts',
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      rollupOptions: {
        // Exclude onnxruntime-web from bundling — let @ricky0123/vad-web's
        // pre-bundled copy resolve WASM files from public/vad/onnx/ at runtime
        external: ['onnxruntime-web'],
        output: {
          paths: {
            'onnxruntime-web': '/vad/onnx/ort-wasm-simd-threaded.mjs',
          },
          manualChunks(id) {
            if (id.includes('node_modules/three')) {
              return 'vendor-three';
            }
            if (id.includes('node_modules/pdfjs-dist')) {
              return 'vendor-pdf';
            }
            if (id.includes('node_modules/katex')) {
              return 'vendor-katex';
            }
            if (id.includes('node_modules/html2canvas')) {
              return 'vendor-canvas';
            }
            return undefined;
          },
        },
      },
    },
  };
});
