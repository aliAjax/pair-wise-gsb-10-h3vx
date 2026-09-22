// 通过 Vite SSR 加载并执行渲染冒烟测试（test-render.jsx）
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  await server.ssrLoadModule('/test-render.jsx');
} finally {
  await server.close();
}
