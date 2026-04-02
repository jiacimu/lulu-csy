/**
 * appLifecycle.ts — 应用前后台切换恢复管理器
 *
 * 解决问题：切后台再切回来黑屏
 *
 * 原因：
 *   1. Android WebView 在后台会暂停 GPU 合成，回来后画面冻住 / 黑屏
 *   2. 全屏模式被系统退出，回来后没有恢复
 *   3. AudioContext 被 suspend
 *
 * 策略：
 *   - 监听 visibilitychange（Web/PWA）
 *   - 监听 Capacitor appStateChange（原生 APK）
 *   - 切回前台时：强制重绘 → 恢复全屏 → 恢复 AudioContext
 */

import { requestSystemFullscreen } from '../App';

let initialized = false;

/**
 * 强制 WebView 重新合成 —— 通过施加一个微小的 transform 变化再还原，
 * 促使浏览器重走合成管线，刷掉黑色帧。
 */
function forceRepaint() {
  const el = document.documentElement;
  // 先施加一个不可见的位移
  el.style.transform = 'translateZ(1px)';
  // 下一帧还原（浏览器此时已触发重绘）
  requestAnimationFrame(() => {
    el.style.transform = '';
  });
}

/**
 * 尝试恢复所有被 suspend 的 AudioContext
 */
function resumeAllAudioContexts() {
  // 标准: window 上可能挂了多个 AudioContext
  // 大多数情况只需要 resume 就行
  try {
    // The BaseAudioContext prototype can give us the list through a global hack,
    // but the simplest & safest approach: dispatch a user-activation style resume.
    // Most browsers auto-resume on next user gesture, but we do it proactively.
    const anyWin = window as any;
    // Webkit/Chrome exposes the running contexts on the constructor
    if (anyWin._audioContexts && Array.isArray(anyWin._audioContexts)) {
      anyWin._audioContexts.forEach((ctx: AudioContext) => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      });
    }
  } catch {
    // 静默
  }
}

/**
 * 切回前台时的恢复流程
 */
function onForeground() {
  // 1. 强制重绘（立即执行，优先级最高）
  forceRepaint();

  // 2. 恢复全屏（requestSystemFullscreen 内部已有 isFullscreenEnabled 守卫）
  //    注意：Fullscreen API 需要用户手势，但某些浏览器在 visibilitychange 中允许
  requestSystemFullscreen();

  // 3. 恢复 AudioContext
  resumeAllAudioContexts();

  // 4. 额外安全网：100ms 后再做一次重绘，确保极端延迟情况下也能恢复
  setTimeout(forceRepaint, 100);
}

/**
 * 初始化应用生命周期监听
 * 应在 React 挂载前调用（与 initSystemInterceptor 同级）
 */
export function initAppLifecycle() {
  if (initialized) return;
  initialized = true;

  // ── Web / PWA: visibilitychange ────────────────────────────
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      onForeground();
    }
  });

  // ── Capacitor 原生: appStateChange ─────────────────────────
  // 动态导入避免在纯 Web 环境报错
  import('@capacitor/app').then(({ App }) => {
    App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        onForeground();
      }
    });
  }).catch(() => {
    // 非 Capacitor 环境，忽略
  });
}
