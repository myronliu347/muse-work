export interface WelcomePrompt {
  id: string;
  icon: string;
  title: string;
  description: string;
  prompt: string;
}

export const WELCOME_PROMPTS: WelcomePrompt[] = [
  {
    id: "explore",
    icon: "folder",
    title: "理解项目",
    description: "摸清目录、模块和怎么跑",
    prompt: "帮我摸清这个项目的结构：目录怎么组织、入口在哪、怎么跑起来。",
  },
  {
    id: "build",
    icon: "add",
    title: "写新功能",
    description: "从一句话开始加能力",
    prompt: "我想加一个新功能：",
  },
  {
    id: "edit",
    icon: "edit",
    title: "修改文件",
    description: "指出文件，直接改",
    prompt: "帮我改这些文件：",
  },
  {
    id: "debug",
    icon: "debug-alt",
    title: "排查问题",
    description: "对着报错一起看",
    prompt: "我遇到了问题，帮我一起看：",
  },
];
