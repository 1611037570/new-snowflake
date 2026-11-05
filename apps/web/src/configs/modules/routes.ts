/**
 * 基础路由列表
 * 包含项目的基础设施
 */

export const BASE_ROUTES = [
  { name: "icon" },
  { name: "color" },
  { name: "components" },
  { name: "init", hidden: true },
];
/**
 * 项目路由列表
 * 包含企业级应用项目路由
 */
export const PROJECT_ROUTES = [
  {
    name: "home",
    icon: "home",
  },
  {
    name: "resume",
    icon: "resume",
  },
  {
    name: "image",
    icon: "image",
  },
  {
    name: "index",
    iconType: "component",
    icon: "index",
  },
];
/**
 * 轻量级路由列表
 * 包含简单小游戏和实用工具路由
 */
export const MUSE_ROUTES = [
  { name: "checklist" },
  { name: "llmMonitor" },
  { name: "test" },
];
/**
 * 基础与项目路由组合列表
 * 包含所有基础路由、项目路由和轻量级路由，用于导航和权限控制
 */
export const ALL_ROUTES = [...BASE_ROUTES, ...PROJECT_ROUTES, ...MUSE_ROUTES];
