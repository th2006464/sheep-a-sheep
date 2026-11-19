/**
 * Cloudflare Worker 入口 —— 纯静态站托管
 * 与 mahjong.game.foxtang.com 相同的部署方式:
 *   wrangler.jsonc 中 assets.directory = "./public",通过 ASSETS 绑定分发。
 * 本游戏为纯前端单机版,无需 API/D1,所有请求直接交给静态资源。
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
